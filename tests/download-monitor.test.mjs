import test from "node:test";
import assert from "node:assert/strict";

import { isTorrentComplete, updateDownloadCompletionWatch } from "../src/download-monitor.js";

test("primes the watch without notifying about existing torrents", () => {
  const result = updateDownloadCompletionWatch(
    { initialized: false, incomplete: {} },
    [
      { hash: "active", name: "Active", progress: 0.4, state: "downloading" },
      { hash: "done", name: "Done", progress: 1, state: "uploading" }
    ]
  );

  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.watch.incomplete, { active: { name: "Active" } });
});

test("reports a completion transition only once", () => {
  const previous = {
    initialized: true,
    incomplete: { active: { name: "Linux ISO" } }
  };
  const completedTorrent = [{ hash: "active", name: "Linux ISO", progress: 1, state: "stalledUP" }];

  const first = updateDownloadCompletionWatch(previous, completedTorrent);
  assert.deepEqual(first.completed, [{ id: "active", name: "Linux ISO" }]);

  const second = updateDownloadCompletionWatch(first.watch, completedTorrent);
  assert.deepEqual(second.completed, []);
});

test("recognizes seeding states and full progress as complete", () => {
  assert.equal(isTorrentComplete({ progress: 0.7, state: "uploading" }), true);
  assert.equal(isTorrentComplete({ progress: 1, state: "pausedDL" }), true);
  assert.equal(isTorrentComplete({ progress: 0.7, state: "pausedDL" }), false);
});
