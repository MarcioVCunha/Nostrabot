const AUDIO_CACHE_KEY = "nostrabot.audioCache.v1";
const HISTORY_CACHE_KEY = "nostrabot.historyCache.v1";

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Quota / private mode — ignore.
  }
}

export function loadCachedAudioRecords() {
  const data = readJson(AUDIO_CACHE_KEY, null);
  if (!data || !Array.isArray(data.items)) return null;
  return data.items;
}

export function saveCachedAudioRecords(items) {
  writeJson(AUDIO_CACHE_KEY, {
    version: 1,
    savedAt: new Date().toISOString(),
    items: Array.isArray(items) ? items : []
  });
}

export function loadCachedHistory() {
  const data = readJson(HISTORY_CACHE_KEY, null);
  if (!data || !Array.isArray(data.events)) return null;
  return data.events;
}

export function saveCachedHistory(events) {
  writeJson(HISTORY_CACHE_KEY, {
    version: 1,
    savedAt: new Date().toISOString(),
    events: Array.isArray(events) ? events.slice(0, 40) : []
  });
}
