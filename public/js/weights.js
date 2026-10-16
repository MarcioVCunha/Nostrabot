const AUDIO_WEIGHTS_KEY = "audioPlayWeights";

export function loadAudioWeights() {
  try {
    const stored = localStorage.getItem(AUDIO_WEIGHTS_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("Erro ao carregar pesos dos audios:", error);
    return {};
  }
}

export function saveAudioWeights(weights) {
  localStorage.setItem(AUDIO_WEIGHTS_KEY, JSON.stringify(weights));
}

function getMaxAudioWeight(weights) {
  const values = Object.values(weights);
  if (!values.length) return 1;
  return Math.max(...values);
}

export function syncAudioWeights(records) {
  const weights = loadAudioWeights();
  const recordUrls = new Set(records.map((record) => record.url));
  const maxWeight = getMaxAudioWeight(weights);

  for (const url of Object.keys(weights)) {
    if (!recordUrls.has(url)) {
      delete weights[url];
    }
  }

  for (const record of records) {
    if (weights[record.url] == null) {
      weights[record.url] = maxWeight;
    }
  }

  saveAudioWeights(weights);
  return weights;
}

export function recordRandomPlay(chosenUrl, records, currentWeights) {
  const weights = { ...currentWeights };

  for (const record of records) {
    if (record.url === chosenUrl) {
      weights[record.url] = 1;
    } else {
      weights[record.url] = (weights[record.url] ?? 1) + 1;
    }
  }

  saveAudioWeights(weights);
  return weights;
}

export function renderAudioWeights(audioWeights) {
  document.querySelectorAll("[data-audio-weight]").forEach((badge) => {
    const url = badge.dataset.audioWeight;
    badge.textContent = `peso ${audioWeights[url] ?? 1}`;
  });
}
