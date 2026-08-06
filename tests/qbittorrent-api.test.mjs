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
