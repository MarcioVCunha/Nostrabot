const audioInput = document.getElementById("audioInput");
const saveButton = document.getElementById("saveButton");
const uploadStatus = document.getElementById("uploadStatus");
const audioList = document.getElementById("audioList");
const audioDropdownSummary = document.getElementById("audioDropdownSummary");
const themeToggle = document.getElementById("themeToggle");
const setupScreen = document.getElementById("setupScreen");
const timerScreen = document.getElementById("timerScreen");
const timerAmountInput = document.getElementById("timerAmount");
const timerUnitSelect = document.getElementById("timerUnit");
const timerSetupStatus = document.getElementById("timerSetupStatus");
const startRandomTimerButton = document.getElementById("startRandomTimerButton");
const cancelRandomTimerButton = document.getElementById("cancelRandomTimerButton");
const playFallbackButton = document.getElementById("playFallbackButton");
const timerProgressRing = document.getElementById("timerProgressRing");
const timeRemainingLabel = document.getElementById("timeRemainingLabel");
const timerStateLabel = document.getElementById("timerStateLabel");

let cachedRecords = [];
let audioWeights = {};
let activeCountdown = null;
let isTimerRunning = false;
let isAudioPlaying = false;
let activeAudio = null;
let wakeLock = null;
let pendingPlay = null;

const AUDIO_WEIGHTS_KEY = "audioPlayWeights";
const TIMER_PREFS_KEY = "timerPrefs";
const ACTIVE_TIMER_KEY = "activeTimer";
const ringRadius = Number(timerProgressRing?.getAttribute("r")) || 180;
const ringCircumference = 2 * Math.PI * ringRadius;

timerProgressRing.style.strokeDasharray = `${ringCircumference}`;
timerProgressRing.style.strokeDashoffset = `${ringCircumference}`;

function getPreferredTheme() {
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  const prefersDark =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  if (!themeToggle) return;
  themeToggle.textContent = theme === "dark" ? "Tema: Escuro" : "Tema: Claro";
}

function showSetupFeedback(message, isError = true) {
  if (!timerSetupStatus) return;
  timerSetupStatus.textContent = message;
  timerSetupStatus.classList.toggle("is-error", isError);
}

function clearSetupFeedback() {
  if (!timerSetupStatus) return;
  timerSetupStatus.textContent = "";
  timerSetupStatus.classList.remove("is-error");
}

function showUploadStatus(message, isError = false) {
  if (!uploadStatus) return;
  uploadStatus.textContent = message;
  uploadStatus.classList.toggle("is-error", isError);
}

function updateUiLock() {
  const locked = isTimerRunning || isAudioPlaying;

  if (startRandomTimerButton) startRandomTimerButton.disabled = locked;
  if (timerAmountInput) timerAmountInput.disabled = locked;
  if (timerUnitSelect) timerUnitSelect.disabled = locked;

  if (cancelRandomTimerButton) {
    cancelRandomTimerButton.disabled = !(isTimerRunning || isAudioPlaying);
  }

  document
    .querySelectorAll('#audioList button[data-role="play"], #audioList button[data-role="delete"]')
    .forEach((btn) => {
      btn.disabled = locked;
    });
}

function showTimerScreen() {
  if (setupScreen) setupScreen.hidden = true;
  if (timerScreen) timerScreen.hidden = false;
  document.body.style.overflow = "hidden";
}

function showSetupScreen() {
  if (timerScreen) timerScreen.hidden = true;
  if (setupScreen) setupScreen.hidden = false;
  document.body.style.overflow = "";
  hidePlayFallback();
}

function hidePlayFallback() {
  pendingPlay = null;
  if (playFallbackButton) playFallbackButton.hidden = true;
}

function showPlayFallback(url, onPlayStart) {
  pendingPlay = { url, onPlayStart };
  if (playFallbackButton) playFallbackButton.hidden = false;
  timerStateLabel.textContent = "Toque para reproduzir";
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch (error) {
    console.warn("Wake Lock indisponivel:", error);
  }
}

function releaseWakeLock() {
  if (!wakeLock) return;
  wakeLock.release().catch(() => {});
  wakeLock = null;
}

function loadTimerPrefs() {
  try {
    const stored = localStorage.getItem(TIMER_PREFS_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (error) {
    console.error("Erro ao carregar preferencias do timer:", error);
    return null;
  }
}

function saveTimerPrefs(amount, unit) {
  localStorage.setItem(
    TIMER_PREFS_KEY,
    JSON.stringify({ amount, unit })
  );
}

function applyTimerPrefs() {
  const prefs = loadTimerPrefs();
  if (!prefs) return;
  if (prefs.amount != null) timerAmountInput.value = prefs.amount;
  if (prefs.unit === "seconds" || prefs.unit === "minutes") {
    timerUnitSelect.value = prefs.unit;
  }
}

function persistActiveTimer() {
  if (!activeCountdown) {
    sessionStorage.removeItem(ACTIVE_TIMER_KEY);
    return;
  }

  sessionStorage.setItem(
    ACTIVE_TIMER_KEY,
    JSON.stringify({
      endAt: activeCountdown.endAt,
      durationMs: activeCountdown.durationMs,
    })
  );
}

function loadActiveTimer() {
  try {
    const stored = sessionStorage.getItem(ACTIVE_TIMER_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed?.endAt || !parsed?.durationMs) return null;
    return parsed;
  } catch (error) {
    console.error("Erro ao carregar timer ativo:", error);
    return null;
  }
}

function clearActiveTimerStorage() {
  sessionStorage.removeItem(ACTIVE_TIMER_KEY);
}

if (themeToggle) {
  applyTheme(getPreferredTheme());
  themeToggle.addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    applyTheme(next);
  });
}

window.addEventListener("beforeunload", (event) => {
  if (!isTimerRunning && !activeCountdown) return;
  event.preventDefault();
  event.returnValue = "";
});

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible") {
    if (isTimerRunning || isAudioPlaying) {
      await requestWakeLock();
    }
    updateCountdownUi();
    return;
  }

  releaseWakeLock();
});

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value) {
  return new Date(value).toLocaleString("pt-BR");
}

function getDisplayName(record) {
  if (record.name) return record.name;
  const raw = (record.pathname || "").split("/").pop() || "audio";
  const withoutTimestamp = raw.replace(/^\d+-/, "");
  return decodeURIComponent(withoutTimestamp);
}

async function uploadAudioFile(file) {
  const response = await fetch("/api/audio", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "x-file-name": encodeURIComponent(file.name),
      "x-content-type": file.type || "audio/mpeg",
    },
    body: file,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Falha ao enviar arquivo para a API.");
  }

  const data = await response.json();
  return data.item;
}

async function getAllAudioRecords() {
  const response = await fetch("/api/audio");
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Falha ao listar arquivos.");
  }
  const data = await response.json();
  return data.items || [];
}

async function deleteAudioRecord(url) {
  const response = await fetch(`/api/audio?url=${encodeURIComponent(url)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Falha ao excluir arquivo.");
  }
}

function cleanupActiveAudio() {
  if (!activeAudio) return;
  try {
    activeAudio.pause();
  } catch (error) {
    // ignore
  }
  activeAudio = null;
}

function playUrl(url, options = {}) {
  const { onPlayStart = null, allowFallback = false } = options;
  if (!url) return;

  cleanupActiveAudio();
  hidePlayFallback();

  isAudioPlaying = true;
  updateUiLock();

  activeAudio = new Audio(url);
  let playStarted = false;

  const markPlayStarted = () => {
    if (playStarted) return;
    playStarted = true;
    if (onPlayStart) onPlayStart();
    timerStateLabel.textContent = "Tocando...";
    hidePlayFallback();
  };

  activeAudio.addEventListener("playing", markPlayStarted, { once: true });

  activeAudio.addEventListener(
    "ended",
    () => {
      isAudioPlaying = false;
      activeAudio = null;
      releaseWakeLock();
      timerStateLabel.textContent = "Aguardando";
      updateUiLock();
      showSetupScreen();
    },
    { once: true }
  );

  activeAudio.addEventListener(
    "error",
    () => {
      isAudioPlaying = false;
      activeAudio = null;
      releaseWakeLock();
      timerStateLabel.textContent = "Erro ao tocar audio";
      updateUiLock();
      showSetupScreen();
    },
    { once: true }
  );

  activeAudio.play().catch((error) => {
    console.error("Erro ao reproduzir audio:", error);
    isAudioPlaying = false;
    activeAudio = null;
    updateUiLock();

    if (allowFallback) {
      showTimerScreen();
      showPlayFallback(url, onPlayStart);
      return;
    }

    showUploadStatus(
      "Nao foi possivel reproduzir automaticamente. Tente novamente.",
      true
    );
    showSetupScreen();
  });
}

function loadAudioWeights() {
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

function saveAudioWeights(weights) {
  localStorage.setItem(AUDIO_WEIGHTS_KEY, JSON.stringify(weights));
}

function getMaxAudioWeight(weights) {
  const values = Object.values(weights);
  if (!values.length) return 1;
  return Math.max(...values);
}

function syncAudioWeights(records) {
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

function getWeightedRandomRecord(records, weights) {
  if (!records.length) return null;

  const totalWeight = records.reduce(
    (sum, record) => sum + (weights[record.url] ?? 1),
    0
  );
  let roll = Math.random() * totalWeight;

  for (const record of records) {
    roll -= weights[record.url] ?? 1;
    if (roll <= 0) return record;
  }

  return records[records.length - 1];
}

function recordRandomPlay(chosenUrl, records) {
  const weights = { ...audioWeights };

  for (const record of records) {
    if (record.url === chosenUrl) {
      weights[record.url] = 1;
    } else {
      weights[record.url] = (weights[record.url] ?? 1) + 1;
    }
  }

  audioWeights = weights;
  saveAudioWeights(weights);
  renderAudioWeights();
}

function renderAudioWeights() {
  document.querySelectorAll("[data-audio-weight]").forEach((badge) => {
    const url = badge.dataset.audioWeight;
    badge.textContent = `peso ${audioWeights[url] ?? 1}`;
  });
}

function toRemainingLabel(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function setRingProgress(percent) {
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = ringCircumference * (1 - clamped / 100);
  timerProgressRing.style.strokeDashoffset = `${offset}`;
}

function stopCountdown(stateText) {
  if (activeCountdown?.timeoutId) clearTimeout(activeCountdown.timeoutId);
  if (activeCountdown?.intervalId) clearInterval(activeCountdown.intervalId);
  activeCountdown = null;
  clearActiveTimerStorage();
  if (stateText) timerStateLabel.textContent = stateText;
  setRingProgress(0);
  timeRemainingLabel.textContent = "--:--";
}

function updateCountdownUi() {
  if (!activeCountdown) return;

  const now = Date.now();
  const remaining = Math.max(0, activeCountdown.endAt - now);
  const elapsed = activeCountdown.durationMs - remaining;
  const percent = (elapsed / activeCountdown.durationMs) * 100;

  setRingProgress(percent);
  timeRemainingLabel.textContent = toRemainingLabel(remaining);

  if (remaining <= 0 && isTimerRunning) {
    handleTimerComplete();
  }
}

function handleTimerComplete() {
  const countdown = activeCountdown;
  if (!countdown) return;

  activeCountdown = null;
  clearActiveTimerStorage();

  if (countdown.intervalId) clearInterval(countdown.intervalId);
  if (countdown.timeoutId) clearTimeout(countdown.timeoutId);

  const chosen = getWeightedRandomRecord(cachedRecords, audioWeights);
  if (!chosen) {
    timerStateLabel.textContent = "Sem audios para tocar";
    isTimerRunning = false;
    releaseWakeLock();
    updateUiLock();
    showSetupScreen();
    return;
  }

  isTimerRunning = false;
  updateUiLock();
  setRingProgress(100);
  timeRemainingLabel.textContent = "00:00";
  timerStateLabel.textContent = "Tocando...";

  playUrl(chosen.url, {
    allowFallback: true,
    onPlayStart: () => {
      recordRandomPlay(chosen.url, cachedRecords);
    },
  });
}

function startCountdown(durationMs, resumeState = null) {
  stopCountdown();

  const startAt = Date.now();
  const endAt = resumeState?.endAt ?? startAt + durationMs;
  const totalDurationMs = resumeState?.durationMs ?? durationMs;
  const remainingMs = Math.max(0, endAt - startAt);

  isTimerRunning = true;
  updateUiLock();
  showTimerScreen();
  requestWakeLock();

  if (cancelRandomTimerButton) cancelRandomTimerButton.disabled = false;
  timerStateLabel.textContent = "Timer rodando";

  const intervalId = setInterval(updateCountdownUi, 250);
  const timeoutId = setTimeout(handleTimerComplete, remainingMs);

  activeCountdown = {
    durationMs: totalDurationMs,
    endAt,
    intervalId,
    timeoutId,
  };

  persistActiveTimer();
  updateCountdownUi();
}

function buildAudioItem(record) {
  const li = document.createElement("li");
  li.className = "audio-item";

  const top = document.createElement("div");
  top.className = "audio-top";

  const nameRow = document.createElement("div");
  nameRow.className = "audio-name-row";

  const name = document.createElement("div");
  name.className = "audio-name";
  name.textContent = getDisplayName(record);

  const weightBadge = document.createElement("span");
  weightBadge.className = "audio-weight";
  weightBadge.dataset.audioWeight = record.url;
  weightBadge.textContent = `peso ${audioWeights[record.url] ?? 1}`;

  nameRow.append(name, weightBadge);

  const actions = document.createElement("div");
  actions.className = "row";

  const playNowButton = document.createElement("button");
  playNowButton.className = "secondary";
  playNowButton.dataset.role = "play";
  playNowButton.textContent = "Reproduzir agora";
  playNowButton.addEventListener("click", () => {
    if (isTimerRunning || isAudioPlaying) return;
    clearSetupFeedback();
    playUrl(record.url);
  });

  const deleteButton = document.createElement("button");
  deleteButton.className = "danger";
  deleteButton.dataset.role = "delete";
  deleteButton.textContent = "Excluir";
  deleteButton.addEventListener("click", async () => {
    const displayName = getDisplayName(record);
    const confirmed = window.confirm(`Excluir "${displayName}"?`);
    if (!confirmed) return;

    deleteButton.disabled = true;
    try {
      await deleteAudioRecord(record.url);
      await refreshList();
      if (!cachedRecords.length) {
        stopCountdown("Sem audios salvos");
      }
      showUploadStatus("Audio excluido com sucesso.");
    } catch (error) {
      console.error(error);
      showUploadStatus(error.message || "Erro ao excluir audio.", true);
      deleteButton.disabled = false;
    }
  });

  actions.append(playNowButton, deleteButton);
  top.append(nameRow, actions);

  const meta = document.createElement("p");
  meta.className = "audio-meta";
  meta.textContent = `${formatBytes(record.size)} | salvo em ${formatDate(record.uploadedAt)}`;

  li.append(top, meta);
  return li;
}

async function refreshList() {
  const records = await getAllAudioRecords();
  records.sort((a, b) => {
    const aTime = new Date(a.uploadedAt).getTime();
    const bTime = new Date(b.uploadedAt).getTime();
    return bTime - aTime;
  });
  cachedRecords = records;
  audioWeights = syncAudioWeights(records);

  audioList.innerHTML = "";
  if (records.length === 0) {
    if (audioDropdownSummary) audioDropdownSummary.textContent = "Audios salvos (0)";
    const empty = document.createElement("li");
    empty.className = "audio-item";
    empty.textContent = "Nenhum audio salvo ainda.";
    audioList.appendChild(empty);
    updateUiLock();
    return;
  }

  if (audioDropdownSummary) {
    audioDropdownSummary.textContent = `Audios salvos (${records.length})`;
  }
  records.forEach((record) => {
    audioList.appendChild(buildAudioItem(record));
  });
  updateUiLock();
}

function startRandomTimer() {
  clearSetupFeedback();

  const amount = Number(timerAmountInput.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showSetupFeedback("Informe um tempo valido.");
    return;
  }

  if (!cachedRecords.length) {
    showSetupFeedback("Nenhum audio salvo.");
    return;
  }

  const unit = timerUnitSelect.value;
  saveTimerPrefs(amount, unit);

  const multiplier = unit === "minutes" ? 60_000 : 1_000;
  const durationMs = amount * multiplier;
  startCountdown(durationMs);
}

function cancelRandomTimer() {
  if (!activeCountdown && !isAudioPlaying) return;

  isTimerRunning = false;
  cleanupActiveAudio();
  isAudioPlaying = false;
  releaseWakeLock();
  hidePlayFallback();

  updateUiLock();
  if (activeCountdown) stopCountdown("Timer cancelado");
  showSetupScreen();
}

async function handleSaveFiles() {
  const files = Array.from(audioInput.files || []);
  if (files.length === 0) {
    showUploadStatus("Escolha ao menos um arquivo de audio.", true);
    return;
  }

  saveButton.disabled = true;

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      showUploadStatus(`Enviando ${index + 1} de ${files.length}...`);
      await uploadAudioFile(file);
    }

    audioInput.value = "";
    showUploadStatus(`${files.length} arquivo(s) salvo(s) com sucesso.`);
    await refreshList();
  } catch (error) {
    console.error(error);
    showUploadStatus(error?.message || "Erro ao salvar os arquivos.", true);
  } finally {
    saveButton.disabled = false;
  }
}

async function resumeTimerIfStored() {
  const stored = loadActiveTimer();
  if (!stored) return;

  const remaining = stored.endAt - Date.now();
  if (remaining > 0) {
    startCountdown(remaining, {
      endAt: stored.endAt,
      durationMs: stored.durationMs,
    });
    return;
  }

  clearActiveTimerStorage();
  if (!cachedRecords.length) return;

  showTimerScreen();
  timerStateLabel.textContent = "Timer encerrado";
  const chosen = getWeightedRandomRecord(cachedRecords, audioWeights);
  if (!chosen) return;

  playUrl(chosen.url, {
    allowFallback: true,
    onPlayStart: () => {
      recordRandomPlay(chosen.url, cachedRecords);
    },
  });
}

async function init() {
  try {
    isTimerRunning = false;
    isAudioPlaying = false;
    activeAudio = null;
    activeCountdown = null;
    showSetupScreen();
    applyTimerPrefs();

    saveButton.addEventListener("click", handleSaveFiles);
    startRandomTimerButton.addEventListener("click", startRandomTimer);
    cancelRandomTimerButton.addEventListener("click", cancelRandomTimer);

    if (playFallbackButton) {
      playFallbackButton.addEventListener("click", () => {
        if (!pendingPlay) return;
        const { url, onPlayStart } = pendingPlay;
        playUrl(url, {
          allowFallback: true,
          onPlayStart,
        });
      });
    }

    await refreshList();
    await resumeTimerIfStored();
    timerStateLabel.textContent = "Aguardando";
    updateUiLock();
  } catch (error) {
    console.error(error);
    showUploadStatus(error?.message || "Erro ao conectar com a API.", true);
    saveButton.disabled = true;
  }
}

init();
