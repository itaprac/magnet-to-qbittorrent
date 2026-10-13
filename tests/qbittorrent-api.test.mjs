import test from "node:test";
import assert from "node:assert/strict";

import { isSuccessfulAddResponse, parseAddResponse } from "../src/qbittorrent-api.js";

test("accepts the standard qBittorrent add response", () => {
  assert.equal(isSuccessfulAddResponse("Ok."), true);
  assert.equal(isSuccessfulAddResponse(""), true);
});

test("accepts a 200 proxy response containing added torrent ids", () => {
  const response = '{"added_torrent_ids":["9826e892ed-d991a14c69ee1e5e916e04beaa3"]}';
  assert.deepEqual(parseAddResponse(response), {
    ok: true,
    addedIds: ["9826e892ed-d991a14c69ee1e5e916e04beaa3"]
  });
});

test("accepts a successful count response and rejects empty failures", () => {
  assert.equal(isSuccessfulAddResponse('{"success_count":1,"failure_count":0}'), true);
  assert.equal(isSuccessfulAddResponse('{"success_count":0,"failure_count":1}'), false);
  assert.equal(isSuccessfulAddResponse('{"added_torrent_ids":[]}'), false);
  assert.equal(isSuccessfulAddResponse("unexpected"), false);
});

const settings = {
  baseUrl: "http://nas.local:8080",
  fallbackUrl: "http://192.168.1.20:8080/",
  username: "admin",
  password: "secret"
};

function hangUntilAborted(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Aborted"));
    signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
  });
}

test("fast fallback wins without waiting for primary timeout and cancels primary", async (t) => {
  const { getCategories, connectedBaseUrl } = await import("../src/qbittorrent-api.js");
  let primarySignal;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fetch = t.mock.method(globalThis, "fetch", async (url, { signal }) => {
    if (url.startsWith(settings.baseUrl)) {
      primarySignal = signal;
      return hangUntilAborted(signal);
    }
    return new Response('{"linux":{}}');
  });
  // No clock advance: the fallback must finish while the primary is still hung.
  assert.deepEqual(await getCategories(settings), ["linux"]);
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(primarySignal.aborted, true);
  assert.equal(connectedBaseUrl(settings), "http://192.168.1.20:8080");
});

test("primary can win and a slow response body cannot block fallback", async (t) => {
  const { apiVersion, connectedBaseUrl } = await import("../src/qbittorrent-api.js");
  let slowSignal;
  t.mock.method(globalThis, "fetch", async (url, { signal }) => {
    if (url.startsWith(settings.baseUrl)) return new Response("2.11");
    slowSignal = signal;
    return { ok: true, status: 200, text: () => hangUntilAborted(signal) };
  });
  assert.equal(await apiVersion(settings), "2.11");
  assert.equal(slowSignal.aborted, true);
  assert.equal(connectedBaseUrl(settings), settings.baseUrl);
});

test("add races reads, authenticates on fallback and sends only one add", async (t) => {
  const { addMagnet } = await import("../src/qbittorrent-api.js");
  const calls = [];
  let authenticated = false;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith(settings.baseUrl)) return hangUntilAborted(init.signal);
    if (url.endsWith("/auth/login")) {
      authenticated = true;
      assert.equal(init.body.get("username"), "admin");
      return new Response("Ok.");
    }
    if (!authenticated) return new Response("Forbidden", { status: 403 });
    if (url.endsWith("/torrents/add")) return new Response("Ok.");
    return new Response("2.11");
  });
  assert.equal((await addMagnet(settings, "magnet:?xt=urn:btih:abc", "linux")).ok, true);
  const adds = calls.filter(({ url }) => url.endsWith("/torrents/add"));
  assert.equal(adds.length, 1);
  assert.equal(adds[0].url, "http://192.168.1.20:8080/api/v2/torrents/add");
  assert.equal(adds[0].init.body.get("category"), "linux");
});

test("a failed add response is not retried through the other address", async (t) => {
  const { addMagnet } = await import("../src/qbittorrent-api.js");
  let adds = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.endsWith("/torrents/add")) {
      adds++;
      throw new TypeError("Failed to fetch");
    }
    return new Response("2.11");
  });
  await assert.rejects(addMagnet(settings, "magnet:?xt=urn:btih:abc"), /may already be added/);
  assert.equal(adds, 1);
});

test("a fast HTTP failure does not beat a working address", async (t) => {
  const { apiVersion } = await import("../src/qbittorrent-api.js");
  t.mock.method(globalThis, "fetch", async (url) => url.startsWith(settings.baseUrl)
    ? new Response("Denied", { status: 401 }) : new Response("2.11"));
  assert.equal(await apiVersion(settings), "2.11");
});

test("missing or duplicate fallback only sends one read", async (t) => {
  const { apiVersion } = await import("../src/qbittorrent-api.js");
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Offline"); });
  for (const fallbackUrl of ["", `${settings.baseUrl}/`]) {
    await assert.rejects(apiVersion({ ...settings, fallbackUrl }), /Network connection failed/);
  }
  assert.equal(fetch.mock.callCount(), 2);
});

test("both failures are reported and invalid fallback is rejected before fetch", async (t) => {
  const { apiVersion } = await import("../src/qbittorrent-api.js");
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Offline"); });
  await assert.rejects(apiVersion(settings), /Neither address worked.*Main URL:.*Fallback URL:/);
  assert.equal(fetch.mock.callCount(), 2);
  await assert.rejects(apiVersion({ ...settings, fallbackUrl: "ftp://nas" }), /Fallback URL must/);
  assert.equal(fetch.mock.callCount(), 2);
});

test("both hung addresses time out together after 5 seconds", async (t) => {
  const { apiVersion } = await import("../src/qbittorrent-api.js");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async (url, { signal }) => hangUntilAborted(signal));
  const result = apiVersion(settings);
  const rejection = assert.rejects(result, /Neither address worked.*5 seconds/);
  t.mock.timers.tick(5000);
  await rejection;
});
