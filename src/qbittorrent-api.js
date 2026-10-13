import { normalizeBaseUrl, validateSettings } from "./shared.js";

function formBody(fields) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  return params;
}

class ConnectionError extends Error {}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** The v1 info hash of a magnet link as lowercase hex, or "" when it has none. */
export function magnetInfoHash(magnetUrl) {
  const match = /[?&]xt=urn:btih:([^&]+)/i.exec(String(magnetUrl));
  if (!match) return "";
  const value = decodeURIComponent(match[1]);
  if (/^[0-9a-f]{40}$/i.test(value)) return value.toLowerCase();
  if (!/^[A-Z2-7]{32}$/i.test(value)) return "";
  let bits = "";
  for (const char of value.toUpperCase()) bits += BASE32.indexOf(char).toString(2).padStart(5, "0");
  return bits.match(/.{4}/g).map((nibble) => parseInt(nibble, 2).toString(16)).join("");
}

/** True for qBittorrent's plain "Fails." answer, which it sends for duplicates and bad links. */
function isFailsResponse(text) {
  return String(text).trim() === "Fails.";
}

let lastConnection = null;

export function connectedBaseUrl(settings) {
  return lastConnection?.baseUrl === normalizeBaseUrl(settings.baseUrl)
    && lastConnection?.fallbackUrl === normalizeBaseUrl(settings.fallbackUrl)
    ? lastConnection.url
    : normalizeBaseUrl(settings.baseUrl);
}

async function firstAvailable(settings, operation) {
  validateSettings(settings);
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const fallbackUrl = normalizeBaseUrl(settings.fallbackUrl);
  const urls = [...new Set([baseUrl, fallbackUrl].filter(Boolean))];
  const controllers = urls.map(() => new AbortController());
  try {
    // Only the winning operation can update the displayed address.
    const winner = await Promise.any(urls.map(async (url, index) => {
      const endpoint = { ...settings, baseUrl: url, fallbackUrl: "", signal: controllers[index].signal };
      return { url, result: await operation(endpoint) };
    }));
    lastConnection = { baseUrl, fallbackUrl, url: winner.url };
    return winner;
  } catch (error) {
    const errors = error.errors ?? [error];
    if (urls.length === 1) throw errors[0];
    throw new Error(`Neither address worked. Main URL: ${errors[0].message} Fallback URL: ${errors[1].message}`);
  } finally {
    controllers.forEach((controller) => controller.abort());
  }
}

async function request(settings, path, init = {}) {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const controller = new AbortController();
  const abort = () => controller.abort();
  settings.signal?.addEventListener("abort", abort, { once: true });
  if (settings.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 5000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: "include",
      signal: controller.signal,
      headers: {
        ...(init.body instanceof FormData ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
        ...(init.headers ?? {})
      }
    });
    // Keep the timeout and cancellation active until the body has arrived.
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text: async () => text,
      json: async () => JSON.parse(text)
    };
  } catch (error) {
    throw new ConnectionError(controller.signal.aborted
      ? "Request cancelled or timed out after 5 seconds."
      : "Network connection failed. Check the URL and network.", { cause: error });
  } finally {
    clearTimeout(timeout);
    settings.signal?.removeEventListener("abort", abort);
  }
}

export function parseAddResponse(text) {
  const normalizedText = text.trim();
  if (["Ok.", ""].includes(normalizedText)) {
    return { ok: true, addedIds: [] };
  }

  try {
    const data = JSON.parse(normalizedText);
    const addedIds = Array.isArray(data?.added_torrent_ids)
      ? data.added_torrent_ids.filter(Boolean).map(String)
      : [];
    const successCount = Number(data?.success_count ?? 0);
    const failureCount = Number(data?.failure_count ?? 0);
    const ok = addedIds.length > 0 || (successCount > 0 && failureCount === 0);
    return { ok, addedIds };
  } catch {
    return { ok: false, addedIds: [] };
  }
}

export function isSuccessfulAddResponse(text) {
  return parseAddResponse(text).ok;
}

async function loginAtUrl(settings) {
  validateSettings(settings);
  const response = await request(settings, "/api/v2/auth/login", {
    method: "POST",
    body: formBody({ username: settings.username, password: settings.password })
  });

  const text = await response.text();
  const normalizedText = text.trim();
  if (response.status === 403) {
    throw new Error("qBittorrent banned this IP after too many failed logins. Wait for the ban to expire or restart qBittorrent.");
  }
  if (response.ok && isFailsResponse(normalizedText)) {
    throw new Error("Wrong username or password.");
  }
  if (!response.ok || !["Ok.", ""].includes(normalizedText)) {
    throw new Error(`Login failed (${response.status}): ${text || response.statusText}`);
  }
}

async function apiVersionAtUrl(settings) {
  let response = await request(settings, "/api/v2/app/webapiVersion", { method: "GET", headers: {} });
  if (response.status === 403) {
    await loginAtUrl(settings);
    response = await request(settings, "/api/v2/app/webapiVersion", { method: "GET", headers: {} });
  }
  if (!response.ok) throw new Error(`Can't reach qBittorrent (${response.status}).`);
  return (await response.text()).trim();
}

async function getCategoriesAtUrl(settings) {
  let response = await request(settings, "/api/v2/torrents/categories", { method: "GET", headers: {} });
  if (response.status === 403) {
    await loginAtUrl(settings);
    response = await request(settings, "/api/v2/torrents/categories", { method: "GET", headers: {} });
  }
  if (!response.ok) throw new Error(`Can't load categories (${response.status}).`);
  const data = await response.json();
  return Object.keys(data).sort((a, b) => a.localeCompare(b));
}

async function getTorrentsAtUrl(settings, { limit = 8 } = {}) {
  validateSettings(settings);
  const params = new URLSearchParams({
    filter: "all",
    sort: "added_on",
    reverse: "true"
  });
  if (Number.isFinite(limit) && limit > 0) params.set("limit", String(limit));

  let response = await request(settings, `/api/v2/torrents/info?${params}`, { method: "GET", headers: {} });
  if (response.status === 403) {
    await loginAtUrl(settings);
    response = await request(settings, `/api/v2/torrents/info?${params}`, { method: "GET", headers: {} });
  }
  if (!response.ok) throw new Error(`Can't load torrents (${response.status}).`);
  return response.json();
}

async function existingTorrentAtUrl(settings, hash) {
  if (!hash) return null;
  const params = new URLSearchParams({ hashes: hash });
  const response = await request(settings, `/api/v2/torrents/info?${params}`, { method: "GET", headers: {} });
  if (!response.ok) return null;
  try {
    const list = await response.json();
    return Array.isArray(list) && list.length ? list[0] : null;
  } catch {
    return null;
  }
}

async function addTorrentAtUrl(settings, source, { category, paused } = {}) {
  validateSettings(settings);

  const makeBody = () => {
    const body = new FormData();
    if (source.file) body.set("torrents", source.file, source.fileName || "download.torrent");
    else body.set("urls", source.url);
    // qBittorrent 5 renamed `paused` to `stopped`; older versions ignore the new name.
    const addPaused = paused ?? settings.addPaused;
    body.set("paused", addPaused ? "true" : "false");
    body.set("stopped", addPaused ? "true" : "false");
    const chosen = category === undefined ? settings.defaultCategory : category;
    if (chosen) body.set("category", chosen);
    if (settings.tags) body.set("tags", settings.tags);
    return body;
  };

  let response = await request(settings, "/api/v2/torrents/add", {
    method: "POST",
    body: makeBody()
  });

  if (response.status === 403) {
    await loginAtUrl(settings);
    response = await request(settings, "/api/v2/torrents/add", {
      method: "POST",
      body: makeBody()
    });
  }

  const text = await response.text();
  const result = parseAddResponse(text);
  if (isFailsResponse(text) || response.status === 409) {
    throw new Error(source.file || !source.url.startsWith("magnet:")
      ? "qBittorrent rejected this torrent. It is already in the list or the file is not a valid torrent."
      : "qBittorrent rejected this magnet. It is already in the list or the link is invalid.");
  }
  if (response.status === 415) throw new Error("This file is not a valid torrent.");
  if (!response.ok || !result.ok) {
    throw new Error(`Add failed (${response.status}): ${text || response.statusText}`);
  }

  return result;
}

export const login = async (settings) => (await firstAvailable(settings, loginAtUrl)).result;
export const apiVersion = async (settings) => (await firstAvailable(settings, apiVersionAtUrl)).result;
export const getCategories = async (settings) => (await firstAvailable(settings, getCategoriesAtUrl)).result;
export const getTorrents = async (settings, options) =>
  (await firstAvailable(settings, (endpoint) => getTorrentsAtUrl(endpoint, options))).result;

export class DuplicateTorrentError extends Error {}

/**
 * Sends a magnet link, a .torrent URL, or a downloaded .torrent file
 * (`{ file, fileName }`) to exactly one address.
 */
export async function addTorrent(settings, source, overrides = {}) {
  validateSettings(settings);
  const target = typeof source === "string" ? { url: source } : source;
  if (!target.file && !/^(magnet:|https?:)/.test(String(target.url))) {
    throw new Error("Not a magnet or torrent link.");
  }
  // Race a read before sending the write to exactly one address.
  const { url } = await firstAvailable(settings, apiVersionAtUrl);
  const endpoint = { ...settings, baseUrl: url, fallbackUrl: "" };
  try {
    const existing = target.url?.startsWith("magnet:")
      ? await existingTorrentAtUrl(endpoint, magnetInfoHash(target.url))
      : null;
    if (existing) {
      const where = existing.category ? ` in ${existing.category}` : "";
      throw new DuplicateTorrentError(`Already in qBittorrent${where}.`);
    }
    return await addTorrentAtUrl(endpoint, target, overrides);
  } catch (error) {
    if (error instanceof ConnectionError) {
      throw new Error("Connection lost while adding. Check the torrent list before retrying; the torrent may already be added.", { cause: error });
    }
    throw error;
  }
}

export async function addMagnet(settings, magnetUrl, overrides = {}) {
  if (!String(magnetUrl).startsWith("magnet:")) throw new Error("Not a magnet link.");
  return addTorrent(settings, magnetUrl, overrides);
}
