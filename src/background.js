import {
  getDownloadCompletionWatch,
  getSettings,
  pushRecentCategory,
  resetDownloadCompletionWatch,
  saveDownloadCompletionWatch,
  shortcutLinks
} from "./shared.js";
import { addMagnet, getCategories, getTorrents } from "./qbittorrent-api.js";
import { updateDownloadCompletionWatch } from "./download-monitor.js";

const runtime = globalThis.browser?.runtime ?? globalThis.chrome.runtime;
const notifications = globalThis.browser?.notifications ?? globalThis.chrome.notifications;
const contextMenus = globalThis.browser?.contextMenus ?? globalThis.chrome.contextMenus;
const alarms = globalThis.browser?.alarms ?? globalThis.chrome?.alarms;
const tabs = globalThis.browser?.tabs ?? globalThis.chrome?.tabs;
const DOWNLOAD_MONITOR_ALARM = "monitor-qbittorrent-downloads";
// Notifications carrying this id prefix open the first shortcut when clicked. The
// prefix is the whole state we need, so it survives a service worker restart.
const SHORTCUT_NOTIFICATION_PREFIX = "open-shortcut:";
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
// status line — so they never raise a system notification.
async function toastInTab(tab, message, kind = "ok") {
  if (!tab?.id || !tabs?.sendMessage) return false;
  try {
    await tabs.sendMessage(tab.id, { type: "SHOW_TOAST", message, kind });
    return true;
  } catch {
    return false;
  }
}

async function handleMagnet(magnetUrl, categoryOverride = undefined) {
  const settings = await getSettings();
  const result = await addMagnet(settings, magnetUrl, categoryOverride);
  const category = categoryOverride === undefined ? settings.defaultCategory : categoryOverride;
  await pushRecentCategory(category);
  monitorDownloads().catch(() => {});
  return { ...result, category };
}

async function performDownloadMonitor() {
  const settings = await getSettings();
  if (!settings.notifyOnComplete) {
    await resetDownloadCompletionWatch();
    return;
  }
  if (!settings.baseUrl || !settings.username || !settings.password) return;

  const torrents = await getTorrents(settings, { limit: null });
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

function ensureDownloadMonitor() {
  if (!alarms) return;
  const created = alarms.create(DOWNLOAD_MONITOR_ALARM, { periodInMinutes: 1 });
  created?.catch?.(() => {});
}

async function getCategoryPickerData() {
  const settings = await getSettings();
  if (!settings.askCategoryOnAdd) {
    return {
      askCategoryOnAdd: false,
      defaultCategory: settings.defaultCategory,
      categories: [],
      recents: settings.recentCategories
    };
  }

  try {
    const categories = await getCategories(settings);
    return {
      askCategoryOnAdd: true,
      defaultCategory: settings.defaultCategory,
      categories,
      recents: settings.recentCategories
    };
  } catch (error) {
    return {
      askCategoryOnAdd: true,
      defaultCategory: settings.defaultCategory,
      categories: settings.defaultCategory ? [settings.defaultCategory] : [],
      recents: settings.recentCategories,
      categoryLoadError: error.message
    };
  }
}

runtime.onInstalled.addListener(() => {
  ensureDownloadMonitor();
  contextMenus?.create({
    id: "send-magnet-to-qbt",
    title: "Send magnet to qBittorrent",
    contexts: ["link"]
  });
});

runtime.onStartup?.addListener(ensureDownloadMonitor);
alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === DOWNLOAD_MONITOR_ALARM) monitorDownloads().catch(() => {});
});

notifications?.onClicked.addListener((notificationId) => {
  if (!String(notificationId).startsWith(SHORTCUT_NOTIFICATION_PREFIX)) return;
  openPrimaryShortcut().catch(() => {});
  notifications.clear(notificationId)?.catch?.(() => {});
});

contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "send-magnet-to-qbt" || !info.linkUrl?.startsWith("magnet:")) return;
  handleMagnet(info.linkUrl)
    .then((result) => toastInTab(tab, `Added${result.category ? ` → ${result.category}` : ""}`))
    .catch(async (error) => {
      // Only fall back to a notification when the page can't show the toast.
      if (!(await toastInTab(tab, error.message, "err"))) await notify("qBittorrent error", error.message);
    });
});

runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_CATEGORY_PICKER_DATA") {
    getCategoryPickerData()
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type !== "ADD_MAGNET") return false;

  handleMagnet(message.magnetUrl, message.category)
    .then((result) => sendResponse({ ok: true, addedIds: result.addedIds }))
    .catch(async (error) => {
      await notify("qBittorrent error", error.message);
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});
