const { HISTORY_PATHNAME, newId } = require("./blob-helpers");
const { updateJsonBlob, readJsonBlob } = require("./json-blob");

function emptyHistory() {
  return { version: 1, events: [] };
}

async function recordPlayEvent({ audioId, audioName, audioUrl } = {}) {
  const event = {
    id: newId(),
    audio_id: audioId || null,
    audio_name: audioName || null,
    audio_url: audioUrl || null,
    played_at: new Date().toISOString()
  };

  await updateJsonBlob(HISTORY_PATHNAME, emptyHistory(), (current) => {
    const events = Array.isArray(current.events) ? current.events : [];
    events.unshift(event);
    return { version: 1, events: events.slice(0, 200) };
  });

  return event;
}

async function listPlayHistory({ limit = 30 } = {}) {
  const { data } = await readJsonBlob(HISTORY_PATHNAME, emptyHistory());
  const events = Array.isArray(data?.events) ? data.events : [];
  return events.slice(0, Math.max(1, Math.min(100, Number(limit) || 30)));
}

module.exports = {
  recordPlayEvent,
  listPlayHistory
};
