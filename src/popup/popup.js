import { getSettings, shortcutLinks } from "../shared.js";
import { connectedBaseUrl, getCategories, getTorrents } from "../qbittorrent-api.js";
import { formatRate, isActiveDownload, stateFor, torrentMeta } from "../torrent-format.js";

const runtime = globalThis.browser?.runtime ?? globalThis.chrome.runtime;
const tabs = globalThis.browser?.tabs ?? globalThis.chrome?.tabs;

const statusText = document.querySelector("#statusText");
const statusDot = document.querySelector(".status-dot");
const queueSummary = document.querySelector("#queueSummary");
const torrentList = document.querySelector("#torrentList");
const openQbit = document.querySelector("#openQbit");
const shortcutBar = document.querySelector("#shortcutBar");
const refresh = document.querySelector("#refresh");
const addForm = document.querySelector("#addForm");
const addButton = document.querySelector("#addButton");
const addStatus = document.querySelector("#addStatus");
const pasteInput = document.querySelector("#pasteInput");
const categorySelect = document.querySelector("#categorySelect");
const optionsBtn = document.querySelector("#options");

let cachedSettings = null;
let renderedShortcuts = "";
let loadingPromise = null;
let categoriesLoaded = false;

// The popup reloads every few seconds; only touch the DOM when the list changed.
function renderShortcuts(settings) {
  const links = shortcutLinks(settings);
  const signature = JSON.stringify(links);
  if (signature === renderedShortcuts) return;
  renderedShortcuts = signature;

  shortcutBar.hidden = !links.length;
  shortcutBar.replaceChildren(
    ...links.map((link) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary chip";
      button.textContent = link.label;
      button.title = link.url;
      button.addEventListener("click", () => tabs?.create({ url: link.url }));
      return button;
    })
  );
}

/** Default first, then recently used, then the rest alphabetically. */
function renderCategories(settings, categories) {
  const ordered = [...new Set([settings.defaultCategory, ...settings.recentCategories, ...categories].filter(Boolean))];
  const known = new Set(categories);
  const current = categoriesLoaded ? categorySelect.value : settings.defaultCategory;
  categorySelect.replaceChildren(
    ...["", ...ordered.filter((category) => known.has(category) || category === settings.defaultCategory)].map((value) => {
      const option = document.createElement("option");
      option.value = value;
      const name = value || "No category";
      option.textContent = value === settings.defaultCategory ? `${name} · default` : name;
      return option;
    })
  );
  categorySelect.value = current;
  if (categorySelect.value !== current) categorySelect.value = settings.defaultCategory;
  categoriesLoaded = true;
}

function setConnectionStatus(text, kind) {
  statusText.textContent = text;
  statusDot.dataset.state = kind;
}

function setAddStatus(text = "", kind = "") {
  addStatus.textContent = text;
  addStatus.dataset.kind = kind;
  pasteInput.dataset.state = kind;
}

function setAddEnabled(enabled) {
  pasteInput.disabled = !enabled;
  categorySelect.disabled = !enabled;
  addButton.disabled = !enabled;
}

function renderEmpty(message, kind = "") {
  torrentList.replaceChildren();
  const item = document.createElement("li");
  item.className = `empty ${kind}`.trim();
  item.textContent = message;
  torrentList.append(item);
  torrentList.setAttribute("aria-busy", "false");
}

function updateQueueSummary(torrents) {
  const active = torrents.filter(isActiveDownload);
  const totalRate = active.reduce((sum, torrent) => sum + (Number(torrent.dlspeed) || 0), 0);
  if (!active.length) {
    queueSummary.textContent = torrents.length ? "No active downloads" : "Empty";
    return;
  }
  queueSummary.textContent = `${active.length} active · ${formatRate(totalRate)}`;
}

function openWebUi() {
  if (cachedSettings?.baseUrl) tabs?.create({ url: connectedBaseUrl(cachedSettings) });
}

function renderTorrents(torrents) {
  updateQueueSummary(torrents);
  if (!torrents.length) {
    renderEmpty("Nothing here yet. Add a magnet to start.");
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const torrent of torrents) {
    const item = document.createElement("li");
    const row = document.createElement("button");
    row.type = "button";
    row.className = "torrent";
    row.title = `${torrent.name || "Torrent"}\n${torrent.category || "No category"} · open in Web UI`;
    row.addEventListener("click", openWebUi);
    const progress = Math.max(0, Math.min(100, Math.floor((torrent.progress ?? 0) * 100)));
    const state = stateFor(torrent);

    const top = document.createElement("span");
    top.className = "torrent-top";
    const name = document.createElement("span");
    name.className = "torrent-name";
    name.textContent = torrent.name || "Torrent";
    const stateElement = document.createElement("span");
    stateElement.className = "torrent-state";
    stateElement.dataset.kind = state.kind;
    stateElement.textContent = state.label;
    top.append(name, stateElement);

    const meta = document.createElement("span");
    meta.className = "torrent-meta";
    torrentMeta(torrent).forEach((value, index) => {
      if (index > 0) {
        const separator = document.createElement("span");
        separator.className = "sep";
        separator.textContent = "·";
        meta.append(separator);
      }
      const element = document.createElement("span");
      element.textContent = value;
      meta.append(element);
    });

    const bar = document.createElement("span");
    bar.className = "bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", `${torrent.name || "Torrent"} progress`);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(progress));
    if (progress >= 100) bar.dataset.state = "done";
    if (state.kind === "error") bar.dataset.state = "error";
    const fill = document.createElement("i");
    fill.style.width = `${progress}%`;
    bar.append(fill);

    row.append(top, meta, bar);
    item.append(row);
    fragment.append(item);
  }
  torrentList.replaceChildren(fragment);
  torrentList.setAttribute("aria-busy", "false");
}

function sendMessage(message) {
  if (globalThis.browser?.runtime) return runtime.sendMessage(message);
  return new Promise((resolve) => {
    runtime.sendMessage(message, (response) => {
      const lastError = globalThis.chrome?.runtime?.lastError;
      resolve(lastError ? { ok: false, error: lastError.message } : response);
    });
  });
}

async function performLoad({ quiet = false } = {}) {
  const settings = await getSettings();
  cachedSettings = settings;
  renderShortcuts(settings);
  refresh.disabled = true;

  if (!settings.baseUrl || !settings.username || !settings.password) {
    setConnectionStatus("Not configured", "warn");
    queueSummary.textContent = "Offline";
    openQbit.disabled = true;
    setAddEnabled(false);
    renderEmpty("Open settings and connect qBittorrent.");
    refresh.disabled = false;
    return;
  }

  try {
    openQbit.disabled = false;
    setAddEnabled(true);
    torrentList.setAttribute("aria-busy", "true");
    if (!quiet && !torrentList.children.length) renderEmpty("Loading queue…");
    const torrents = await getTorrents(settings, { limit: 8 });
    const url = new URL(connectedBaseUrl(settings));
    setConnectionStatus(`Connected · ${url.host}`, "ok");
    renderTorrents(torrents);
    if (!categoriesLoaded) renderCategories(settings, await getCategories(settings).catch(() => []));
  } catch (error) {
    setConnectionStatus("Can't reach qBittorrent", "err");
    queueSummary.textContent = "Unavailable";
    openQbit.disabled = false;
    setAddEnabled(false);
    if (!quiet || !torrentList.children.length) renderEmpty(error.message, "err");
  } finally {
    torrentList.setAttribute("aria-busy", "false");
    refresh.disabled = false;
  }
}

function loadPopup(options) {
  if (loadingPromise) return loadingPromise;
  loadingPromise = performLoad(options).finally(() => {
    loadingPromise = null;
  });
  return loadingPromise;
}

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const magnetUrl = pasteInput.value.trim();
  if (!magnetUrl.startsWith("magnet:")) {
    setAddStatus("Paste a valid magnet link.", "error");
    pasteInput.focus();
    return;
  }

  setAddEnabled(false);
  setAddStatus("Sending…", "sending");
  try {
    const category = categorySelect.value;
    const response = await sendMessage({ type: "ADD_MAGNET", magnetUrl, category });
    if (!response?.ok) throw new Error(response?.error || "Add failed.");
    setAddStatus(category ? `Added to ${category}.` : "Added.", "sent");
    pasteInput.value = "";
    await loadPopup({ quiet: true });
  } catch (error) {
    setAddStatus(error.message, "error");
  } finally {
    setAddEnabled(true);
  }
});

pasteInput.addEventListener("input", () => {
  if (addStatus.textContent) setAddStatus();
});

openQbit.addEventListener("click", openWebUi);
refresh.addEventListener("click", () => loadPopup());
optionsBtn.addEventListener("click", () => runtime.openOptionsPage());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadPopup({ quiet: true });
});

loadPopup();
// Opening the popup is a good moment to bring the toolbar badge up to date.
sendMessage({ type: "REFRESH_BADGE" })?.catch?.(() => {});
setInterval(() => {
  if (!document.hidden) loadPopup({ quiet: true });
}, 5000);
