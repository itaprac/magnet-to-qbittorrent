import { MAX_SHORTCUTS, getSettings, saveSettings, shortcutLink } from "../shared.js";
import { connectedBaseUrl, apiVersion, getCategories, getTorrents } from "../qbittorrent-api.js";

const form = document.querySelector("#settingsForm");
const saveButton = document.querySelector("#save");
const saveStatus = document.querySelector("#saveStatus");
const testStatus = document.querySelector("#testStatus");
const testButton = document.querySelector("#test");
const categorySelect = document.querySelector("#defaultCategory");
const torrentPreview = document.querySelector("#torrentPreview");
const previewSummary = document.querySelector("#previewSummary");
const refreshTorrentsButton = document.querySelector("#refreshTorrents");
const loadCategoriesButton = document.querySelector("#loadCategories");
const openQbitButton = document.querySelector("#openQbit");
const shortcutList = document.querySelector("#shortcutList");
const shortcutEmpty = document.querySelector("#shortcutEmpty");
const addShortcutButton = document.querySelector("#addShortcut");
const tabs = globalThis.browser?.tabs ?? globalThis.chrome?.tabs;
const connectionStatusText = document.querySelector("#connectionStatusText");
const connectionDot = document.querySelector(".status-dot");

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

function setConnectionStatus(text, kind, detail = "") {
  connectionStatusText.textContent = text;
  connectionStatusText.title = detail;
  connectionDot.dataset.state = kind;
}

function setInlineStatus(text = "", kind = "idle") {
  testStatus.textContent = text;
  testStatus.dataset.state = kind;
}

function setSaveStatus(text = "", kind = "") {
  saveStatus.textContent = text;
  saveStatus.dataset.state = kind;
}

function formToSettings() {
  return {
    baseUrl: form.baseUrl.value,
    fallbackUrl: form.fallbackUrl.value,
    username: form.username.value,
    password: form.password.value,
    defaultCategory: form.defaultCategory.value,
    askCategoryOnAdd: form.askCategoryOnAdd.checked,
    addPaused: form.addPaused.checked,
    tags: form.tags.value,
    showNotifications: form.showNotifications.checked,
    notifyOnComplete: form.notifyOnComplete.checked,
    shortcuts: readShortcuts()
  };
}

function readShortcuts() {
  return [...shortcutList.querySelectorAll(".shortcut")].map((row) => ({
    enabled: row.querySelector(".shortcut-enabled").checked,
    label: row.querySelector(".shortcut-label").value,
    url: row.querySelector(".shortcut-url").value
  }));
}

function createShortcutRow(shortcut) {
  const row = document.createElement("li");
  row.className = "shortcut";

  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.className = "shortcut-enabled";
  enabled.checked = shortcut.enabled !== false;
  enabled.setAttribute("aria-label", "Show this shortcut in the popup");

  const label = document.createElement("input");
  label.type = "text";
  label.className = "shortcut-label";
  label.maxLength = 40;
  label.placeholder = "Plex";
  label.value = shortcut.label ?? "";
  label.setAttribute("aria-label", "Shortcut name");

  const url = document.createElement("input");
  url.type = "url";
  url.className = "shortcut-url";
  url.placeholder = "http://localhost:32400/web";
  url.value = shortcut.url ?? "";
  url.setAttribute("aria-label", "Shortcut address");

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "quiet shortcut-remove";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    row.remove();
    syncShortcutList();
    setSaveStatus("Unsaved changes", "dirty");
  });

  row.append(enabled, label, url, remove);
  return row;
}

function syncShortcutList() {
  const count = shortcutList.querySelectorAll(".shortcut").length;
  shortcutEmpty.hidden = count > 0;
  addShortcutButton.disabled = count >= MAX_SHORTCUTS;
}

function fillShortcuts(shortcuts) {
  shortcutList.replaceChildren(...shortcuts.map(createShortcutRow));
  syncShortcutList();
}

function fillForm(settings) {
  form.baseUrl.value = settings.baseUrl ?? "";
  form.fallbackUrl.value = settings.fallbackUrl ?? "";
  form.username.value = settings.username ?? "";
  form.password.value = settings.password ?? "";
  form.tags.value = settings.tags ?? "";
  form.askCategoryOnAdd.checked = Boolean(settings.askCategoryOnAdd);
  form.addPaused.checked = Boolean(settings.addPaused);
  form.showNotifications.checked = Boolean(settings.showNotifications);
  form.notifyOnComplete.checked = Boolean(settings.notifyOnComplete);
  fillShortcuts(settings.shortcuts ?? []);
  setCategoryOptions([], settings.defaultCategory ?? "");
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
  torrentPreview.replaceChildren();
  const item = document.createElement("li");
  item.className = `empty ${kind}`.trim();
  item.textContent = message;
  torrentPreview.append(item);
}

function renderTorrentPreview(torrents) {
  previewSummary.textContent = torrents.length ? `${torrents.length} most recently added.` : "From this Web UI.";
  if (!torrents.length) {
    renderEmpty("No torrents to show.");
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
    const values = [torrent.category || "no category", formatRate(torrent.dlspeed), `${progress}%`];
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
  torrentPreview.replaceChildren(fragment);
}

function setCategoryOptions(categories, selected) {
  const values = ["", ...new Set(categories.filter(Boolean))];
  if (selected && !values.includes(selected)) values.push(selected);
  categorySelect.replaceChildren(
    ...values.map((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value || "No category";
      option.selected = value === selected;
      return option;
    })
  );
}

async function persist({ announce = false } = {}) {
  const saved = await saveSettings(formToSettings());
  form.baseUrl.value = saved.baseUrl;
  fillShortcuts(saved.shortcuts);
  if (announce) {
    const broken = saved.shortcuts.filter((shortcut) => shortcut.enabled && !shortcutLink(shortcut));
    if (broken.length) {
      const which = broken[0].label || "One shortcut";
      setSaveStatus(`Saved · ${which} needs a full http:// or https:// address.`, "dirty");
      return saved;
    }
    setSaveStatus("Saved.", "ok");
    setTimeout(() => {
      if (saveStatus.textContent === "Saved.") setSaveStatus();
    }, 1800);
  }
  return saved;
}

async function checkConnection(knownSettings = null) {
  setConnectionStatus("Checking…", "loading");
  const settings = knownSettings ?? (await getSettings());
  openQbitButton.disabled = !settings.baseUrl;
  if (!settings.baseUrl || !settings.username || !settings.password) {
    setConnectionStatus("Not configured", "warn");
    return;
  }

  try {
    const version = await apiVersion(settings);
    const url = new URL(connectedBaseUrl(settings));
    setConnectionStatus(`Connected · ${url.host} · v${version}`, "ok");
  } catch (error) {
    setConnectionStatus("Can't reach qBittorrent", "err", error.message);
  }
}

async function loadTorrentPreview() {
  const settings = await getSettings();
  if (!settings.baseUrl || !settings.username || !settings.password) {
    previewSummary.textContent = "Connect first.";
    renderEmpty("Connect qBittorrent to see the queue.");
    return;
  }
  renderEmpty("Loading…");
  try {
    renderTorrentPreview(await getTorrents(settings, { limit: 8 }));
  } catch (error) {
    previewSummary.textContent = "Unavailable.";
    renderEmpty(error.message, "err");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  setSaveStatus("Saving…");
  try {
    const saved = await persist({ announce: true });
    await checkConnection(saved);
    await loadTorrentPreview();
  } catch (error) {
    setSaveStatus(error.message, "err");
  } finally {
    saveButton.disabled = false;
  }
});

form.addEventListener("input", () => {
  setSaveStatus("Unsaved changes", "dirty");
});

addShortcutButton.addEventListener("click", () => {
  if (shortcutList.querySelectorAll(".shortcut").length >= MAX_SHORTCUTS) return;
  const row = createShortcutRow({ enabled: true, label: "", url: "" });
  shortcutList.append(row);
  syncShortcutList();
  row.querySelector(".shortcut-label").focus();
  setSaveStatus("Unsaved changes", "dirty");
});

testButton.addEventListener("click", async () => {
  if (!form.reportValidity()) return;
  testButton.disabled = true;
  setInlineStatus("Testing…", "busy");
  setConnectionStatus("Testing…", "loading");
  try {
    const settings = formToSettings();
    const version = await apiVersion(settings);
    const url = new URL(connectedBaseUrl(settings));
    setInlineStatus(`Connected · v${version}`, "ok");
    setConnectionStatus(`Connected · ${url.host} · v${version}`, "ok");
  } catch (error) {
    setInlineStatus(error.message, "err");
    setConnectionStatus("Can't reach qBittorrent", "err", error.message);
  } finally {
    testButton.disabled = false;
  }
});

loadCategoriesButton.addEventListener("click", async () => {
  if (!form.reportValidity()) return;
  loadCategoriesButton.disabled = true;
  setInlineStatus("Loading categories…", "busy");
  try {
    const settings = formToSettings();
    const categories = await getCategories(settings);
    setCategoryOptions(categories, settings.defaultCategory);
    setInlineStatus(`${categories.length} categories loaded.`, "ok");
  } catch (error) {
    setInlineStatus(error.message, "err");
  } finally {
    loadCategoriesButton.disabled = false;
  }
});

openQbitButton.addEventListener("click", async () => {
  const settings = await getSettings();
  if (settings.baseUrl) await tabs?.create({ url: connectedBaseUrl(settings) });
});

refreshTorrentsButton.addEventListener("click", loadTorrentPreview);

(async function init() {
  const settings = await getSettings();
  fillForm(settings);
  await checkConnection(settings);
  await loadTorrentPreview();
})();
