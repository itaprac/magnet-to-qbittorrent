import { MAX_SHORTCUTS, getSettings, saveSettings, shortcutLink } from "../shared.js";
import { connectedBaseUrl, apiVersion, getCategories } from "../qbittorrent-api.js";

const form = document.querySelector("#settingsForm");
const saveButton = document.querySelector("#save");
const saveStatus = document.querySelector("#saveStatus");
const testStatus = document.querySelector("#testStatus");
const testButton = document.querySelector("#test");
const categorySelect = document.querySelector("#defaultCategory");
const categoryHint = document.querySelector("#categoryHint");
const loadCategoriesButton = document.querySelector("#loadCategories");
const openQbitButton = document.querySelector("#openQbit");
const shortcutList = document.querySelector("#shortcutList");
const shortcutEmpty = document.querySelector("#shortcutEmpty");
const addShortcutButton = document.querySelector("#addShortcut");
const tabs = globalThis.browser?.tabs ?? globalThis.chrome?.tabs;
const connectionStatusText = document.querySelector("#connectionStatusText");
const connectionDot = document.querySelector(".status-dot");

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
    showBadge: form.showBadge.checked,
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
  form.showBadge.checked = Boolean(settings.showBadge);
  fillShortcuts(settings.shortcuts ?? []);
  setCategoryOptions([], settings.defaultCategory ?? "");
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

/** Fills the category list from qBittorrent, keeping the chosen default. */
async function loadCategories(settings, { announce = false } = {}) {
  try {
    const categories = await getCategories(settings);
    setCategoryOptions(categories, categorySelect.value || settings.defaultCategory);
    categoryHint.textContent = `${categories.length} ${categories.length === 1 ? "category" : "categories"} in qBittorrent.`;
    if (announce) setInlineStatus(`${categories.length} categories loaded.`, "ok");
  } catch (error) {
    categoryHint.textContent = "Couldn't load categories. Check the connection.";
    if (announce) setInlineStatus(error.message, "err");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  setSaveStatus("Saving…");
  try {
    const saved = await persist({ announce: true });
    await checkConnection(saved);
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
    await loadCategories(settings);
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
    await loadCategories(formToSettings(), { announce: true });
  } finally {
    loadCategoriesButton.disabled = false;
  }
});

openQbitButton.addEventListener("click", async () => {
  const settings = await getSettings();
  if (settings.baseUrl) await tabs?.create({ url: connectedBaseUrl(settings) });
});

(async function init() {
  const settings = await getSettings();
  fillForm(settings);
  if (settings.baseUrl && settings.username && settings.password) {
    await Promise.all([checkConnection(settings), loadCategories(settings)]);
  } else {
    await checkConnection(settings);
  }
})();
