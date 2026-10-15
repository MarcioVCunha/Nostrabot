const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const AUDIO_PREFIX = "audios/";
const INDEX_PATHNAME = "data/audios-index.json";
const HISTORY_PATHNAME = "data/play-history.json";
const ROOM_PREFIX = "rooms/";
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function getSafeFileName(name) {
  return (name || "audio")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/_+/g, "_");
}

function isAudioContentType(contentType) {
  if (!contentType || typeof contentType !== "string") return false;
  return contentType.trim().toLowerCase().startsWith("audio/");
}

function extensionFromContentType(contentType, fallbackName = "") {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("webm")) return "webm";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("wav")) return "wav";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  const fromName = String(fallbackName || "").split(".").pop();
  if (fromName && /^[a-z0-9]{2,5}$/i.test(fromName)) return fromName.toLowerCase();
  return "webm";
}

function buildAudioPathname(id, contentType, originalName) {
  const ext = extensionFromContentType(contentType, originalName);
  return `${AUDIO_PREFIX}${id}.${ext}`;
}

function roomPathname(code) {
  return `${ROOM_PREFIX}${String(code || "").toUpperCase()}.json`;
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isWithinTrashWindow(deletedAt, now = Date.now()) {
  if (!deletedAt) return false;
  const ts = new Date(deletedAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return now - ts <= TRASH_RETENTION_MS;
}

module.exports = {
  MAX_UPLOAD_BYTES,
  AUDIO_PREFIX,
  INDEX_PATHNAME,
  HISTORY_PATHNAME,
  ROOM_PREFIX,
  TRASH_RETENTION_MS,
  getSafeFileName,
  isAudioContentType,
  extensionFromContentType,
  buildAudioPathname,
  roomPathname,
  newId,
  isWithinTrashWindow
};
