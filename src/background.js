import {
  getDownloadCompletionWatch,
  getSettings,
  pushRecentCategory,
  resetDownloadCompletionWatch,
  saveDownloadCompletionWatch,
  shortcutLinks
} from "./shared.js";
import { addTorrent, getCategories, getTorrents } from "./qbittorrent-api.js";
import { updateDownloadCompletionWatch } from "./download-monitor.js";
import { isActiveDownload } from "./torrent-format.js";

const runtime = globalThis.browser?.runtime ?? globalThis.chrome.runtime;
const notifications = globalThis.browser?.notifications ?? globalThis.chrome.notifications;
const contextMenus = globalThis.browser?.contextMenus ?? globalThis.chrome.contextMenus;
const alarms = globalThis.browser?.alarms ?? globalThis.chrome?.alarms;
const tabs = globalThis.browser?.tabs ?? globalThis.chrome?.tabs;
const storage = globalThis.browser?.storage ?? globalThis.chrome?.storage;
// MV3 Chrome has `action`; the MV2 Firefox build has `browserAction`.
const action = globalThis.browser?.action ?? globalThis.browser?.browserAction
  ?? globalThis.chrome?.action ?? globalThis.chrome?.browserAction;
const DOWNLOAD_MONITOR_ALARM = "monitor-qbittorrent-downloads";
// Notifications carrying this id prefix open the first shortcut when clicked. The
// prefix is the whole state we need, so it survives a service worker restart.
const SHORTCUT_NOTIFICATION_PREFIX = "open-shortcut:";
const MENU_ROOT = "send-magnet-to-qbt";
const MENU_DEFAULT = "send-to-default";
const MENU_CATEGORY_PREFIX = "send-to-category:";
const BADGE_ACCENT = "#efa73c";
const BADGE_DANGER = "#ee6a55";
const BADGE_INK = "#1d1609";
const MAX_TORRENT_FILE_BYTES = 10 * 1024 * 1024;
let notificationCounter = 0;

async function notify(title, message, preference = "showNotifications", knownSettings = null, id = null) {
  const settings = knownSettings ?? (await getSettings());
  if (!settings[preference] || !notifications) return;
  const options = {
    type: "basic",
    iconUrl: runtime.getURL("icons/icon-128.png"),
    title,
    message
  };
  const created = id ? notifications.create(id, options) : notifications.create(options);
  await created?.catch?.(() => {});
}

async function openPrimaryShortcut() {
  const [link] = shortcutLinks(await getSettings());
  if (link) await tabs?.create({ url: link.url });
}

// Adds are confirmed where they happen — an in-page toast or the popup's own
// status line — so they never raise a system notification. The toast goes to
// the top frame only, since the content script also runs inside iframes.
async function toastInTab(tab, message, kind = "ok") {
  if (!tab?.id || !tabs?.sendMessage) return false;
  try {
    const response = await tabs.sendMessage(tab.id, { type: "SHOW_TOAST", message, kind }, { frameId: 0 });
    return response?.ok === true;
  } catch {
    return false;
  }
}

/**
 * qBittorrent downloads a .torrent URL itself, without this browser's cookies,
 * so links behind a tracker login fail. Fetch the file here first and upload it;
 * fall back to handing qBittorrent the URL when the download doesn't work.
 */
async function torrentSource(url) {
  if (url.startsWith("magnet:")) return { url };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { credentials: "include", signal: controller.signal });
    if (!response.ok) return { url };
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A bencoded torrent is a dictionary, so it always starts with "d".
    if (!bytes.length || bytes.length > MAX_TORRENT_FILE_BYTES || bytes[0] !== 0x64) return { url };
    const disposition = response.headers.get("content-disposition") ?? "";
    const fromHeader = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
    const fromPath = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    const fileName = fromHeader ? decodeURIComponent(fromHeader) : fromPath || "download.torrent";
    return { file: new Blob([bytes], { type: "application/x-bittorrent" }), fileName };
  } catch {
    return { url };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleAdd(url, overrides = {}) {
  const settings = await getSettings();
  const result = await addTorrent(settings, await torrentSource(url), overrides);
  const category = overrides.category === undefined ? settings.defaultCategory : overrides.category;
  await pushRecentCategory(category);
  monitorDownloads().catch(() => {});
  return { ...result, category };
}

function setBadge(text, color = BADGE_ACCENT, title = "") {
  if (!action?.setBadgeText) return;
  action.setBadgeText({ text })?.catch?.(() => {});
  action.setBadgeBackgroundColor?.({ color })?.catch?.(() => {});
  action.setBadgeTextColor?.({ color: BADGE_INK })?.catch?.(() => {});
  action.setTitle?.({ title: title || "Magnet to qBittorrent" })?.catch?.(() => {});
}

function updateBadge(settings, torrents) {
  if (!settings.showBadge) {
    setBadge("");
    return;
  }
  const active = torrents.filter(isActiveDownload).length;
  setBadge(active ? String(active) : "", BADGE_ACCENT, active ? `Magnet to qBittorrent · ${active} downloading` : "");
}

async function performDownloadMonitor() {
  const settings = await getSettings();
  if (!settings.notifyOnComplete) await resetDownloadCompletionWatch();
  if (!settings.baseUrl || !settings.username || !settings.password) {
    setBadge("");
    return;
  }
  if (!settings.notifyOnComplete && !settings.showBadge) {
    setBadge("");
    return;
  }

  let torrents;
  try {
    torrents = await getTorrents(settings, { limit: null });
  } catch (error) {
    if (settings.showBadge) setBadge("!", BADGE_DANGER, `Can't reach qBittorrent: ${error.message}`);
    throw error;
  }
  updateBadge(settings, torrents);
  if (!settings.notifyOnComplete) return;

  const previous = await getDownloadCompletionWatch();
  const scopedPrevious = previous.baseUrl === settings.baseUrl
    ? previous
    : { initialized: false, incomplete: {} };
  const { completed, watch } = updateDownloadCompletionWatch(scopedPrevious, torrents);
  await saveDownloadCompletionWatch({ ...watch, baseUrl: settings.baseUrl });

  const [shortcut] = shortcutLinks(settings);
  for (const torrent of completed) {
    await notify(
      shortcut ? `Download complete → open ${shortcut.label}` : "Download complete",
      torrent.name.slice(0, 120),
      "notifyOnComplete",
      settings,
      shortcut ? `${SHORTCUT_NOTIFICATION_PREFIX}${Date.now()}-${notificationCounter++}` : null
    );
  }
}

let monitorPromise = null;
function monitorDownloads() {
  if (monitorPromise) return monitorPromise;
  monitorPromise = performDownloadMonitor().finally(() => {
    monitorPromise = null;
  });
  return monitorPromise;
}

async function ensureDownloadMonitor() {
  if (!alarms) return;
  // Re-creating an alarm restarts its period, so leave a running one alone.
  if (await Promise.resolve(alarms.get(DOWNLOAD_MONITOR_ALARM)).catch(() => null)) return;
  await Promise.resolve(alarms.create(DOWNLOAD_MONITOR_ALARM, { periodInMinutes: 1 })).catch(() => {});
}

// Context menu: one entry per category, so a right-click can pick where the
// torrent lands. Rebuilt only when the categories or the default change.
let menuSignature = null;
let menuQueue = Promise.resolve();

function createMenuItem(properties) {
  contextMenus.create(properties, () => void runtime.lastError);
}

async function buildContextMenu(settings, categories) {
  const signature = JSON.stringify([settings.defaultCategory, categories]);
  if (!contextMenus || signature === menuSignature) return;
  menuSignature = signature;
  await Promise.resolve(contextMenus.removeAll()).catch(() => {});

  createMenuItem({ id: MENU_ROOT, title: "Send to qBittorrent", contexts: ["link"] });
  if (!categories) return;

  const defaultLabel = settings.defaultCategory || "no category";
  createMenuItem({ id: MENU_DEFAULT, parentId: MENU_ROOT, title: `Default (${defaultLabel})`, contexts: ["link"] });
  createMenuItem({ id: "separator", parentId: MENU_ROOT, type: "separator", contexts: ["link"] });
  for (const category of ["", ...categories]) {
    createMenuItem({
      id: `${MENU_CATEGORY_PREFIX}${category}`,
      parentId: MENU_ROOT,
      title: category || "No category",
      contexts: ["link"]
    });
  }
}

function refreshContextMenu() {
  menuQueue = menuQueue.then(async () => {
    const settings = await getSettings();
    let categories = null;
    if (settings.baseUrl && settings.username && settings.password) {
      categories = await getCategories(settings).catch(() => null);
    }
    await buildContextMenu(settings, categories);
  }).catch(() => {});
  return menuQueue;
}

async function getCategoryPickerData() {
  const settings = await getSettings();
  const base = {
    askCategoryOnAdd: settings.askCategoryOnAdd,
    defaultCategory: settings.defaultCategory,
    addPaused: settings.addPaused,
    recents: settings.recentCategories
  };
  if (!settings.askCategoryOnAdd) return { ...base, categories: [] };

  try {
    return { ...base, categories: await getCategories(settings) };
  } catch (error) {
    return {
      ...base,
      categories: settings.defaultCategory ? [settings.defaultCategory] : [],
      categoryLoadError: error.message
    };
  }
}

function onTick() {
  ensureDownloadMonitor().catch(() => {});
  monitorDownloads().catch(() => {});
  refreshContextMenu();
}

runtime.onInstalled.addListener(onTick);
runtime.onStartup?.addListener(onTick);
alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== DOWNLOAD_MONITOR_ALARM) return;
  monitorDownloads().catch(() => {});
  refreshContextMenu();
});

storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local") return;
  const relevant = ["baseUrl", "fallbackUrl", "username", "password", "defaultCategory", "showBadge", "notifyOnComplete"];
  if (!relevant.some((key) => key in changes)) return;
  monitorDownloads().catch(() => {});
  refreshContextMenu();
});

notifications?.onClicked.addListener((notificationId) => {
  if (!String(notificationId).startsWith(SHORTCUT_NOTIFICATION_PREFIX)) return;
  openPrimaryShortcut().catch(() => {});
  notifications.clear(notificationId)?.catch?.(() => {});
});

contextMenus?.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  let overrides;
  if (id === MENU_ROOT || id === MENU_DEFAULT) overrides = {};
  else if (id.startsWith(MENU_CATEGORY_PREFIX)) overrides = { category: id.slice(MENU_CATEGORY_PREFIX.length) };
  else return;

  const url = info.linkUrl ?? "";
  if (!/^(magnet:|https?:)/.test(url)) {
    toastInTab(tab, "Not a magnet or torrent link.", "err");
    return;
  }
  handleAdd(url, overrides)
    .then((result) => toastInTab(tab, `Added${result.category ? ` → ${result.category}` : ""}`))
    .catch(async (error) => {
      // Only fall back to a notification when the page can't show the toast.
      if (!(await toastInTab(tab, error.message, "err"))) await notify("qBittorrent error", error.message);
    });
});

runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_CATEGORY_PICKER_DATA") {
    getCategoryPickerData()
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "PICK_IN_TOP_FRAME") {
    const tabId = sender.tab?.id;
    if (tabId === undefined || !tabs?.sendMessage) return false;
    Promise.resolve(tabs.sendMessage(tabId, { type: "PICK_FROM_FRAME", magnetUrl: message.magnetUrl }, { frameId: 0 }))
      .then((response) => sendResponse({ ok: response?.ok === true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "REFRESH_BADGE") {
    monitorDownloads().catch(() => {});
    return false;
  }

  if (message?.type !== "ADD_MAGNET") return false;

  const overrides = {};
  if (message.category !== undefined) overrides.category = message.category;
  if (typeof message.paused === "boolean") overrides.paused = message.paused;
  handleAdd(message.magnetUrl, overrides)
    .then((result) => sendResponse({ ok: true, addedIds: result.addedIds, category: result.category }))
    // Both senders, the page toast and the popup, show the error themselves.
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

// A service worker can start for any event; make sure the badge and menu exist.
onTick();
