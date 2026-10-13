import test from "node:test";
import assert from "node:assert/strict";

import { formatEta, formatSize, isActiveDownload, torrentMeta } from "../src/torrent-format.js";

test("ETA reads as the largest two units and hides qBittorrent's infinity", () => {
  assert.equal(formatEta(42), "42s");
  assert.equal(formatEta(12 * 60), "12m");
  assert.equal(formatEta(3 * 3600 + 20 * 60), "3h 20m");
  assert.equal(formatEta(2 * 86400 + 4 * 3600), "2d 4h");
  assert.equal(formatEta(8640000), "");
  assert.equal(formatEta(0), "");
});

test("sizes use binary units", () => {
  assert.equal(formatSize(1536), "1.5 KB");
  assert.equal(formatSize(4.2 * 1024 ** 3), "4.2 GB");
});

test("only unfinished downloading states count as active", () => {
  assert.equal(isActiveDownload({ state: "downloading", progress: 0.4 }), true);
  assert.equal(isActiveDownload({ state: "metaDL", progress: 0 }), true);
  assert.equal(isActiveDownload({ state: "pausedDL", progress: 0.4 }), false);
  assert.equal(isActiveDownload({ state: "stalledUP", progress: 1 }), false);
});

test("row meta shows progress, speed, ETA and size, or size once complete", () => {
  const downloading = { state: "downloading", progress: 0.426, dlspeed: 5 * 1024 ** 2, eta: 720, size: 2 * 1024 ** 3 };
  assert.deepEqual(torrentMeta(downloading), ["42%", "5.0 MB/s", "12m left", "2.0 GB"]);
  assert.deepEqual(torrentMeta({ state: "pausedDL", progress: 0.1, size: 1024 ** 3 }), ["10%", "1.0 GB"]);
  assert.deepEqual(torrentMeta({ state: "stalledUP", progress: 1, size: 1024 ** 3 }), ["1.0 GB", "complete"]);
});
