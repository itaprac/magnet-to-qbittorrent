/* torrent-format.js — labels and number formatting for qBittorrent torrent rows. */

const RATE_UNITS = ["B/s", "KB/s", "MB/s", "GB/s"];
const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"];
// qBittorrent reports this ETA when it has no estimate.
const ETA_INFINITY = 8640000;

export const STATE_LABELS = {
  downloading: { label: "downloading", kind: "downloading" },
  stalledDL: { label: "waiting", kind: "downloading" },
  metaDL: { label: "metadata", kind: "downloading" },
  forcedMetaDL: { label: "metadata", kind: "downloading" },
  forcedDL: { label: "downloading", kind: "downloading" },
  queuedDL: { label: "queued", kind: "downloading" },
  checkingDL: { label: "checking", kind: "downloading" },
  allocating: { label: "allocating", kind: "downloading" },
  uploading: { label: "seeding", kind: "uploading" },
  stalledUP: { label: "complete", kind: "uploading" },
  forcedUP: { label: "seeding", kind: "uploading" },
  queuedUP: { label: "complete", kind: "uploading" },
  checkingUP: { label: "checking", kind: "uploading" },
  stoppedUP: { label: "complete", kind: "uploading" },
  pausedUP: { label: "complete", kind: "uploading" },
  stoppedDL: { label: "stopped", kind: "stopped" },
  pausedDL: { label: "paused", kind: "paused" },
  error: { label: "error", kind: "error" },
  missingFiles: { label: "missing", kind: "error" }
};

export function stateFor(torrent) {
  return STATE_LABELS[torrent?.state] ?? { label: torrent?.state || "unknown", kind: "" };
}

function scaled(value, units) {
  let size = Number(value) || 0;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const fixed = size >= 100 || unit === 0 ? size.toFixed(0) : size.toFixed(1);
  return `${fixed} ${units[unit]}`;
}

export const formatRate = (value = 0) => scaled(value, RATE_UNITS);
export const formatSize = (value = 0) => scaled(value, SIZE_UNITS);

/** "45s", "12m", "3h 20m", "2d 4h", or "" when qBittorrent has no estimate. */
export function formatEta(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0 || value >= ETA_INFINITY) return "";
  if (value < 60) return `${Math.round(value)}s`;
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

/** Downloading right now, or waiting for its turn to download. */
export function isActiveDownload(torrent) {
  return Number(torrent?.progress ?? 0) < 0.999999 && stateFor(torrent).kind === "downloading";
}

/** The values shown under a torrent's name, most useful first. */
export function torrentMeta(torrent) {
  const progress = Math.max(0, Math.min(100, Math.floor((torrent?.progress ?? 0) * 100)));
  const size = Number(torrent?.size) > 0 ? formatSize(torrent.size) : "";
  if (progress >= 100) return [size, "complete"].filter(Boolean);
  const eta = isActiveDownload(torrent) ? formatEta(torrent.eta) : "";
  return [
    `${progress}%`,
    isActiveDownload(torrent) ? formatRate(torrent.dlspeed) : "",
    eta ? `${eta} left` : "",
    size
  ].filter(Boolean);
}
