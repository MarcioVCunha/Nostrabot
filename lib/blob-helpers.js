const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const AUDIO_PREFIX = "audios/";

function getSafeFileName(name) {
  return (name || "audio")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/_+/g, "_");
}

function isAllowedBlobUrl(url) {
  if (!url || typeof url !== "string") return false;

  try {
    const parsed = new URL(url);
    return parsed.pathname.includes(`/${AUDIO_PREFIX}`);
  } catch (error) {
    return false;
  }
}

function isAudioContentType(contentType) {
  if (!contentType || typeof contentType !== "string") return false;
  return contentType.trim().toLowerCase().startsWith("audio/");
}

function buildAudioPathname(originalName, now = Date.now()) {
  const safeName = getSafeFileName(originalName);
  return `${AUDIO_PREFIX}${now}-${safeName}`;
}

module.exports = {
  MAX_UPLOAD_BYTES,
  AUDIO_PREFIX,
  getSafeFileName,
  isAllowedBlobUrl,
  isAudioContentType,
  buildAudioPathname
};
