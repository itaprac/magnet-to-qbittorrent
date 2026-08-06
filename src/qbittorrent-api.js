import { normalizeBaseUrl, validateSettings } from "./shared.js";

function formBody(fields) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  return params;
}

async function request(settings, path, init = {}) {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
      ...(init.headers ?? {})
    }
  });
  return response;
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

export async function login(settings) {
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

export async function apiVersion(settings) {
  let response = await request(settings, "/api/v2/app/webapiVersion", { method: "GET", headers: {} });
  if (response.status === 403) {
    await login(settings);
    response = await request(settings, "/api/v2/app/webapiVersion", { method: "GET", headers: {} });
  }
  if (!response.ok) throw new Error(`Can't reach qBittorrent (${response.status}).`);
  return (await response.text()).trim();
}

export async function getCategories(settings) {
  let response = await request(settings, "/api/v2/torrents/categories", { method: "GET", headers: {} });
  if (response.status === 403) {
    await login(settings);
    response = await request(settings, "/api/v2/torrents/categories", { method: "GET", headers: {} });
  }
  if (!response.ok) throw new Error(`Can't load categories (${response.status}).`);
  const data = await response.json();
  return Object.keys(data).sort((a, b) => a.localeCompare(b));
}

export async function getTorrents(settings, { limit = 8 } = {}) {
  validateSettings(settings);
  const params = new URLSearchParams({
    filter: "all",
    sort: "added_on",
    reverse: "true"
  });
  if (Number.isFinite(limit) && limit > 0) params.set("limit", String(limit));

  let response = await request(settings, `/api/v2/torrents/info?${params}`, { method: "GET", headers: {} });
  if (response.status === 403) {
    await login(settings);
    response = await request(settings, `/api/v2/torrents/info?${params}`, { method: "GET", headers: {} });
  }
  if (!response.ok) throw new Error(`Can't load torrents (${response.status}).`);
  return response.json();
}

export async function addMagnet(settings, magnetUrl, categoryOverride = undefined) {
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
    await login(settings);
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
