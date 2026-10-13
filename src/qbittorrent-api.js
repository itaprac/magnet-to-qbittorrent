import { normalizeBaseUrl, validateSettings } from "./shared.js";

function formBody(fields) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  return params;
}

class ConnectionError extends Error {}

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

async function addMagnetAtUrl(settings, magnetUrl, categoryOverride = undefined) {
  validateSettings(settings);
  if (!String(magnetUrl).startsWith("magnet:")) throw new Error("Not a magnet link.");

  const makeBody = () => {
    const body = new FormData();
    body.set("urls", magnetUrl);
    body.set("paused", settings.addPaused ? "true" : "false");
    const category = categoryOverride === undefined ? settings.defaultCategory : categoryOverride;
    if (category) body.set("category", category);
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

export async function addMagnet(settings, magnetUrl, categoryOverride) {
  validateSettings(settings);
  if (!String(magnetUrl).startsWith("magnet:")) throw new Error("Not a magnet link.");
  // Race a read before sending the write to exactly one address.
  const { url } = await firstAvailable(settings, apiVersionAtUrl);
  try {
    return await addMagnetAtUrl({ ...settings, baseUrl: url, fallbackUrl: "" }, magnetUrl, categoryOverride);
  } catch (error) {
    if (error instanceof ConnectionError) {
      throw new Error("Connection lost while adding. Check the torrent list before retrying; the torrent may already be added.", { cause: error });
    }
    throw error;
  }
}
