import { getSettings, shortcutLinks } from "../shared.js";
import { connectedBaseUrl, getTorrents } from "../qbittorrent-api.js";

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
const optionsBtn = document.querySelector("#options");

const UNITS = ["B/s", "KB/s", "MB/s", "GB/s"];
const STATE_LABELS = {
  downloading: { label: "downloading", kind: "downloading" },
  stalledDL: { label: "waiting", kind: "downloading" },
  metaDL: { label: "metadata", kind: "downloading" },
  forcedDL: { label: "downloading", kind: "downloading" },
  queuedDL: { label: "queued", kind: "downloading" },
  checkingDL: { label: "checking", kind: "downloading" },
  uploading: { label: "seeding", kind: "uploading" },
  stalledUP: { label: "complete", kind: "uploading" },
  forcedUP: { label: "seeding", kind: "uploading" },
  queuedUP: { label: "complete", kind: "uploading" },
  checkingUP: { label: "checking", kind: "uploading" },
  stoppedUP: { label: "complete", kind: "uploading" },
  pausedUP: { label: "complete", kind: "uploading" },
  stoppedDL: { label: "stopped", kind: "stopped" },
  pausedDL: { label: "paused", kind: "paused" },
  error: { label: "error", kind: "error" },
  missingFiles: { label: "missing", kind: "error" }
};

let cachedSettings = null;
let renderedShortcuts = "";
let loadingPromise = null;

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

function setConnectionStatus(text, kind) {
  statusText.textContent = text;
  statusDot.dataset.state = kind;
}

function setAddStatus(text = "", kind = "") {
  addStatus.textContent = text;
  addStatus.dataset.kind = kind;
  pasteInput.dataset.state = kind;
}

function formatRate(value = 0) {
  let size = Number(value) || 0;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const fixed = size >= 100 || unit === 0 ? size.toFixed(0) : size.toFixed(1);
  return `${fixed} ${UNITS[unit]}`;
}

function stateFor(torrent) {
  return STATE_LABELS[torrent.state] ?? { label: torrent.state || "unknown", kind: "" };
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
  const active = torrents.filter((torrent) => (torrent.progress ?? 0) < 0.999999 && torrent.state !== "pausedDL" && torrent.state !== "stoppedDL");
  const totalRate = active.reduce((sum, torrent) => sum + (Number(torrent.dlspeed) || 0), 0);
  if (!active.length) {
    queueSummary.textContent = torrents.length ? "No active downloads" : "Empty";
    return;
  }
  queueSummary.textContent = `${active.length} active · ${formatRate(totalRate)}`;
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
    item.className = "torrent";
    const progress = Math.max(0, Math.min(100, Math.round((torrent.progress ?? 0) * 100)));
    const state = stateFor(torrent);

    const top = document.createElement("div");
    top.className = "torrent-top";
    const name = document.createElement("span");
    name.className = "torrent-name";
    name.textContent = torrent.name || "Torrent";
    name.title = torrent.name || "Torrent";
    const stateElement = document.createElement("span");
    stateElement.className = "torrent-state";
    stateElement.dataset.kind = state.kind;
    stateElement.textContent = state.label;
    top.append(name, stateElement);

    const meta = document.createElement("div");
    meta.className = "torrent-meta";
    const values = [
      torrent.category || "no category",
      progress < 100 ? formatRate(torrent.dlspeed) : "complete",
      `${progress}%`
    ];
    values.forEach((value, index) => {
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

    const bar = document.createElement("div");
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

    item.append(top, meta, bar);
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
    pasteInput.disabled = true;
    addButton.disabled = true;
    renderEmpty("Open settings and connect qBittorrent.");
    refresh.disabled = false;
    return;
  }

  try {
    openQbit.disabled = false;
    pasteInput.disabled = false;
    addButton.disabled = false;
    torrentList.setAttribute("aria-busy", "true");
    if (!quiet && !torrentList.children.length) renderEmpty("Loading queue…");
    const torrents = await getTorrents(settings, { limit: 8 });
    const url = new URL(connectedBaseUrl(settings));
    setConnectionStatus(`Connected · ${url.host}`, "ok");
    renderTorrents(torrents);
  } catch (error) {
    setConnectionStatus("Can't reach qBittorrent", "err");
    queueSummary.textContent = "Unavailable";
    openQbit.disabled = false;
    pasteInput.disabled = true;
    addButton.disabled = true;
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

  addButton.disabled = true;
  pasteInput.disabled = true;
  setAddStatus("Sending…", "sending");
  try {
    const response = await sendMessage({ type: "ADD_MAGNET", magnetUrl });
    if (!response?.ok) throw new Error(response?.error || "Add failed.");
    const category = cachedSettings?.defaultCategory;
    setAddStatus(category ? `Added to ${category}.` : "Added.", "sent");
    pasteInput.value = "";
    await loadPopup({ quiet: true });
  } catch (error) {
    setAddStatus(error.message, "error");
  } finally {
    pasteInput.disabled = false;
    addButton.disabled = false;
  }
});

pasteInput.addEventListener("input", () => {
  if (addStatus.textContent) setAddStatus();
});

openQbit.addEventListener("click", async () => {
  if (cachedSettings?.baseUrl) await tabs?.create({ url: connectedBaseUrl(cachedSettings) });
});
refresh.addEventListener("click", () => loadPopup());
optionsBtn.addEventListener("click", () => runtime.openOptionsPage());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadPopup({ quiet: true });
});

loadPopup();
setInterval(() => {
  if (!document.hidden) loadPopup({ quiet: true });
}, 5000);
