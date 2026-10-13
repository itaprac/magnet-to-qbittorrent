export const DEFAULT_SETTINGS = {
  baseUrl: "",
  fallbackUrl: "",
  username: "",
  password: "",
  defaultCategory: "",
  askCategoryOnAdd: true,
  addPaused: false,
  tags: "browser",
  showNotifications: true,
  notifyOnComplete: true,
  shortcuts: [],
  recentCategories: []
};

export const MAX_SHORTCUTS = 6;

const MAX_RECENT = 5;
const DOWNLOAD_WATCH_KEY = "downloadCompletionWatch";
// Pre-0.4 single "media app" shortcut. Read once, then folded into `shortcuts`.
const LEGACY_MEDIA_DEFAULTS = { mediaAppEnabled: false, mediaAppUrl: "", mediaAppLabel: "" };

const storageArea = globalThis.browser?.storage?.local ?? globalThis.chrome?.storage?.local;

export async function getSettings() {
  const stored = await storageArea.get({ ...DEFAULT_SETTINGS, ...LEGACY_MEDIA_DEFAULTS });
  const { mediaAppEnabled, mediaAppUrl, mediaAppLabel, ...rest } = { ...DEFAULT_SETTINGS, ...stored };
  return {
    ...rest,
    recentCategories: Array.isArray(stored.recentCategories) ? stored.recentCategories : [],
    shortcuts: normalizeShortcuts(
      Array.isArray(stored.shortcuts) && stored.shortcuts.length
        ? stored.shortcuts
        : [{ enabled: mediaAppEnabled, label: mediaAppLabel, url: mediaAppUrl }]
    )
  };
}

export async function saveSettings(settings) {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  const clean = { ...merged };
  clean.baseUrl = normalizeBaseUrl(clean.baseUrl);
  clean.fallbackUrl = normalizeBaseUrl(clean.fallbackUrl);
  validateFallbackUrl(clean.fallbackUrl);
  clean.username = String(clean.username ?? "").trim();
  clean.password = String(clean.password ?? "");
  clean.defaultCategory = String(clean.defaultCategory ?? "");
  clean.askCategoryOnAdd = Boolean(clean.askCategoryOnAdd);
  clean.tags = String(clean.tags ?? "").trim();
  clean.addPaused = Boolean(clean.addPaused);
  clean.showNotifications = Boolean(clean.showNotifications);
  clean.notifyOnComplete = Boolean(clean.notifyOnComplete);
  clean.shortcuts = normalizeShortcuts(merged.shortcuts);
  clean.recentCategories = Array.isArray(merged.recentCategories)
    ? merged.recentCategories.filter(Boolean).slice(0, MAX_RECENT)
    : [];
  await storageArea.set(clean);
  return clean;
}

export async function getDownloadCompletionWatch() {
  const stored = await storageArea.get({
    [DOWNLOAD_WATCH_KEY]: { initialized: false, incomplete: {} }
  });
  const watch = stored[DOWNLOAD_WATCH_KEY];
  return {
    initialized: watch?.initialized === true,
    baseUrl: String(watch?.baseUrl ?? ""),
    incomplete: watch?.incomplete && typeof watch.incomplete === "object" ? watch.incomplete : {}
  };
}

export async function saveDownloadCompletionWatch(watch) {
  await storageArea.set({ [DOWNLOAD_WATCH_KEY]: watch });
}

export async function resetDownloadCompletionWatch() {
  await saveDownloadCompletionWatch({ initialized: false, baseUrl: "", incomplete: {} });
}

export async function pushRecentCategory(category) {
  if (!category) return;
  const settings = await getSettings();
  const next = [category, ...settings.recentCategories.filter((c) => c !== category)].slice(0, MAX_RECENT);
  await saveSettings({ ...settings, recentCategories: next });
}

export function normalizeBaseUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function validateFallbackUrl(value) {
  if (!normalizeBaseUrl(value)) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error("Fallback URL must be a valid http:// or https:// address.");
  }
}

export function validateSettings(settings) {
  if (!settings.baseUrl) throw new Error("qBittorrent Web UI URL is missing.");
  let parsed;
  try {
    parsed = new URL(settings.baseUrl);
  } catch {
    throw new Error("qBittorrent Web UI URL is not valid.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("URL must start with http:// or https://.");
  }
  validateFallbackUrl(settings.fallbackUrl);
  if (!settings.username) throw new Error("Username is required.");
  if (!settings.password) throw new Error("Password is required.");
}

/**
 * Cleans up a stored/edited shortcut list. Entries that are entirely blank are
 * dropped; everything else is kept as typed so the user can fix it later.
 * Trailing slashes survive on purpose — Plex web URLs end in `#!/`.
 */
export function normalizeShortcuts(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((shortcut) => ({
      enabled: shortcut?.enabled !== false,
      label: String(shortcut?.label ?? "").trim().slice(0, 40),
      url: String(shortcut?.url ?? "").trim()
    }))
    .filter((shortcut) => shortcut.url || shortcut.label)
    .slice(0, MAX_SHORTCUTS);
}

/**
 * Turns one shortcut into something openable, or null when it can't be opened
 * in a tab. The label falls back to the host so a bare URL still gets a button.
 */
export function shortcutLink(shortcut) {
  const url = String(shortcut?.url ?? "").trim();
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  const label = String(shortcut?.label ?? "").trim() || parsed.hostname || "Shortcut";
  return { url, label };
}

/** Every shortcut that is switched on and openable, in the user's order. */
export function shortcutLinks(settings) {
  return normalizeShortcuts(settings?.shortcuts)
    .filter((shortcut) => shortcut.enabled)
    .map(shortcutLink)
    .filter(Boolean);
}

export function extensionUrl(path) {
  const runtime = globalThis.browser?.runtime ?? globalThis.chrome?.runtime;
  return runtime?.getURL ? runtime.getURL(path) : path;
}
