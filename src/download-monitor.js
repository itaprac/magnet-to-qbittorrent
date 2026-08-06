const COMPLETE_STATES = new Set([
  "uploading",
  "stalledUP",
  "forcedUP",
  "queuedUP",
  "checkingUP",
  "pausedUP",
  "stoppedUP"
]);

export function torrentIdentity(torrent) {
  if (torrent?.hash) return String(torrent.hash);
  if (!torrent?.name) return "";
  return `${torrent.name}:${torrent.added_on ?? "unknown"}`;
}

export function isTorrentComplete(torrent) {
  return Number(torrent?.progress ?? 0) >= 0.999999 || COMPLETE_STATES.has(torrent?.state);
}

export function updateDownloadCompletionWatch(previous, torrents) {
  const initialized = previous?.initialized === true;
  const previouslyIncomplete = previous?.incomplete && typeof previous.incomplete === "object"
    ? previous.incomplete
    : {};
  const incomplete = {};
  const completed = [];

  for (const torrent of torrents ?? []) {
    const id = torrentIdentity(torrent);
    if (!id) continue;

    if (isTorrentComplete(torrent)) {
      if (initialized && previouslyIncomplete[id]) {
        completed.push({ id, name: torrent.name || previouslyIncomplete[id].name || "Torrent" });
      }
      continue;
    }

    incomplete[id] = { name: torrent.name || "Torrent" };
  }

  return {
    completed,
    watch: { initialized: true, incomplete }
  };
}
