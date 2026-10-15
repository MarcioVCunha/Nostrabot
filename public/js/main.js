import { ensureAdminKey } from "./admin-key.js";
import {
  deleteAudioRecord,
  getAllAudioRecords,
  restoreAudioRecord,
  uploadAudioFile
} from "./api.js";
import { drawWeightedRecord } from "./draw.js";
import { formatBytes, formatDate, getDisplayName } from "./format.js";
import { listPlayHistory, recordPlayEvent } from "./history.js";
import {
  ensureNotificationPermission,
  notifyTimerEnded
} from "./notifications.js";
import { createMicRecorder } from "./recorder.js";
import {
  cancelRoomTimer,
  createRoom,
  getRoom,
  getRoomCodeFromLocation,
  serverNowMs,
  setRoomInLocation,
  setRoomState,
  startRoomTimer,
  subscribeRoom,
  noteRoomRevision,
  syncServerClock
} from "./rooms.js";
import { friendlyUserError } from "./errors.js";
import { initPrankAd } from "./prank-ad.js";
import { initThemeToggle } from "./theme.js";
import { showToast } from "./toast.js";
import {
  recordRandomPlay,
  renderAudioWeights,
  syncAudioWeights
} from "./weights.js";

const audioInput = document.getElementById("audioInput");
const saveButton = document.getElementById("saveButton");
const recordButton = document.getElementById("recordButton");
const changeAdminKeyButton = document.getElementById("changeAdminKeyButton");
const trashToggleButton = document.getElementById("trashToggleButton");
const audioSearch = document.getElementById("audioSearch");
const dropZone = document.getElementById("dropZone");
const uploadProgressList = document.getElementById("uploadProgressList");
const uploadStatus = document.getElementById("uploadStatus");
const audioList = document.getElementById("audioList");
const audioDropdownSummary = document.getElementById("audioDropdownSummary");
const themeToggle = document.getElementById("themeToggle");
const appShell = document.getElementById("appShell");
const setupScreen = document.getElementById("setupScreen");
const timerScreen = document.getElementById("timerScreen");
const timerAmountMinInput = document.getElementById("timerAmountMin");
const timerAmountMaxInput = document.getElementById("timerAmountMax");
const timerUnitSelect = document.getElementById("timerUnit");
const timerAutoRepeat = document.getElementById("timerAutoRepeat");
const timerNoRepeat = document.getElementById("timerNoRepeat");
const timerNotify = document.getElementById("timerNotify");
const timerSetupStatus = document.getElementById("timerSetupStatus");
const startRandomTimerButton = document.getElementById("startRandomTimerButton");
const pauseResumeTimerButton = document.getElementById("pauseResumeTimerButton");
const cancelRandomTimerButton = document.getElementById("cancelRandomTimerButton");
const playFallbackButton = document.getElementById("playFallbackButton");
const timerProgressRing = document.getElementById("timerProgressRing");
const timeRemainingLabel = document.getElementById("timeRemainingLabel");
const timerStateLabel = document.getElementById("timerStateLabel");
const listHint = document.getElementById("listHint");
const playHistoryList = document.getElementById("playHistoryList");
const createRoomButton = document.getElementById("createRoomButton");
const copyRoomLinkButton = document.getElementById("copyRoomLinkButton");
const roomStatus = document.getElementById("roomStatus");
const roomHint = document.getElementById("roomHint");
const enableSoundButton = document.getElementById("enableSoundButton");
const soundStatus = document.getElementById("soundStatus");

let cachedRecords = [];
let audioWeights = {};
let activeCountdown = null;
let isTimerRunning = false;
let isTimerPaused = false;
let isAudioPlaying = false;
let activeAudio = null;
let wakeLock = null;
let pendingPlay = null;
let showingTrash = false;
let searchQuery = "";
let pendingAutoRepeat = false;
let currentRoomCode = null;
let unsubRoom = null;
let applyingRemoteState = false;
/** @type {object | null} latest room.state from server */
let latestRoomState = null;
/** revision whose drawn audio we already started playing */
let playedRevision = -1;
let soundUnlocked = false;
let roomRepeatInFlight = false;

const TIMER_PREFS_KEY = "timerPrefs";
const ACTIVE_TIMER_KEY = "activeTimer";
const ringRadius = Number(timerProgressRing?.getAttribute("r")) || 180;
const ringCircumference = 2 * Math.PI * ringRadius;

if (timerProgressRing) {
  timerProgressRing.style.strokeDasharray = `${ringCircumference}`;
  timerProgressRing.style.strokeDashoffset = `${ringCircumference}`;
}

function showSetupFeedback(message, isError = true) {
  if (!timerSetupStatus) return;
  timerSetupStatus.textContent = friendlyUserError(
    message,
    "Falha ao iniciar o timer."
  );
  timerSetupStatus.classList.toggle("is-error", isError);
}

function clearSetupFeedback() {
  if (!timerSetupStatus) return;
  timerSetupStatus.textContent = "";
  timerSetupStatus.classList.remove("is-error");
}

function showUploadStatus(message, isError = false) {
  if (!uploadStatus) return;
  uploadStatus.textContent = isError
    ? friendlyUserError(message, "Algo deu errado. Tente de novo.")
    : message;
  uploadStatus.classList.toggle("is-error", isError);
}

function updateUiLock() {
  const locked = (isTimerRunning && !isTimerPaused) || isAudioPlaying;
  if (startRandomTimerButton) startRandomTimerButton.disabled = locked || isTimerPaused;
  if (timerAmountMinInput) timerAmountMinInput.disabled = locked || isTimerPaused;
  if (timerAmountMaxInput) timerAmountMaxInput.disabled = locked || isTimerPaused;
  if (timerUnitSelect) timerUnitSelect.disabled = locked || isTimerPaused;
  if (cancelRandomTimerButton) {
    cancelRandomTimerButton.disabled = !(isTimerRunning || isTimerPaused || isAudioPlaying);
  }
  if (pauseResumeTimerButton) {
    pauseResumeTimerButton.disabled = !(isTimerRunning || isTimerPaused) || isAudioPlaying;
    pauseResumeTimerButton.textContent = isTimerPaused ? "Continuar" : "Pausar";
  }
  document
    .querySelectorAll('#audioList button[data-role="play"], #audioList button[data-role="delete"], #audioList button[data-role="restore"]')
    .forEach((btn) => {
      btn.disabled = locked || isTimerPaused;
    });
}

function showTimerScreen() {
  if (setupScreen) setupScreen.hidden = true;
  if (timerScreen) timerScreen.hidden = false;
  if (appShell) appShell.classList.add("is-timing");
}

function showSetupScreen() {
  if (timerScreen) timerScreen.hidden = true;
  if (setupScreen) setupScreen.hidden = false;
  if (appShell) appShell.classList.remove("is-timing");
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
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

function saveTimerPrefs(prefs) {
  localStorage.setItem(TIMER_PREFS_KEY, JSON.stringify(prefs));
}

function applyTimerPrefs() {
  const prefs = loadTimerPrefs();
  if (!prefs) return;
  if (prefs.min != null && timerAmountMinInput) timerAmountMinInput.value = prefs.min;
  if (prefs.max != null && timerAmountMaxInput) timerAmountMaxInput.value = prefs.max;
  if (prefs.amount != null && timerAmountMinInput && !prefs.min) {
    timerAmountMinInput.value = prefs.amount;
    timerAmountMaxInput.value = prefs.amount;
  }
  if (prefs.unit === "seconds" || prefs.unit === "minutes") {
    timerUnitSelect.value = prefs.unit;
  }
  if (timerAutoRepeat) timerAutoRepeat.checked = Boolean(prefs.autoRepeat);
  if (timerNoRepeat) timerNoRepeat.checked = Boolean(prefs.noRepeat);
  if (timerNotify) timerNotify.checked = prefs.notify !== false;
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
      durationMs: activeCountdown.durationMs
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
    return null;
  }
}

function clearActiveTimerStorage() {
  sessionStorage.removeItem(ACTIVE_TIMER_KEY);
}

initThemeToggle(themeToggle);
initPrankAd();

window.addEventListener("beforeunload", (event) => {
  if (!isTimerRunning && !activeCountdown) return;
  event.preventDefault();
  event.returnValue = "";
});

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible") {
    if (isTimerRunning || isAudioPlaying) await requestWakeLock();
    updateCountdownUi();
    return;
  }
  releaseWakeLock();
});

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
      if (currentRoomCode) {
        maybeStartRoomRepeat();
        return;
      }
      if (pendingAutoRepeat && cachedRecords.length) {
        pendingAutoRepeat = false;
        startCountdown(pickDurationMs());
        return;
      }
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
      timerStateLabel.textContent = "Erro ao tocar áudio";
      updateUiLock();
      showSetupScreen();
    },
    { once: true }
  );

  activeAudio.play().catch((error) => {
    console.error(error);
    isAudioPlaying = false;
    activeAudio = null;
    updateUiLock();
    if (allowFallback) {
      showTimerScreen();
      showPlayFallback(url, onPlayStart);
      return;
    }
    showUploadStatus(
      "Não foi possível reproduzir automaticamente. Tente novamente.",
      true
    );
    showSetupScreen();
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
  const now = currentRoomCode ? serverNowMs() : Date.now();
  const remaining = Math.max(0, activeCountdown.endAt - now);
  const elapsed = activeCountdown.durationMs - remaining;
  const percent = (elapsed / activeCountdown.durationMs) * 100;
  setRingProgress(percent);
  timeRemainingLabel.textContent = toRemainingLabel(remaining);
  if (remaining <= 0 && isTimerRunning) handleTimerComplete();
}

function updateRoomUi() {
  if (roomStatus) {
    roomStatus.textContent = currentRoomCode
      ? `Sala ${currentRoomCode}`
      : "Sem sala";
  }
  if (copyRoomLinkButton) copyRoomLinkButton.disabled = !currentRoomCode;
  if (roomHint) {
    roomHint.textContent = currentRoomCode
      ? `Link: ${window.location.origin}${window.location.pathname}?room=${currentRoomCode}`
      : "";
  }
  updateSoundUi();
}

function updateSoundUi() {
  if (!soundStatus && !enableSoundButton) return;
  if (!currentRoomCode) {
    if (enableSoundButton) enableSoundButton.hidden = true;
    if (soundStatus) soundStatus.textContent = "";
    return;
  }
  if (enableSoundButton) enableSoundButton.hidden = soundUnlocked;
  if (soundStatus) {
    soundStatus.textContent = soundUnlocked
      ? "Som ativo neste dispositivo"
      : "Som bloqueado — toque em Ativar som";
    soundStatus.classList.toggle("is-error", !soundUnlocked);
  }
}

async function unlockSound() {
  try {
    const silent = new Audio(
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="
    );
    silent.volume = 0.01;
    await silent.play();
    silent.pause();
  } catch (error) {
    console.warn("Unlock som:", error);
  }
  soundUnlocked = true;
  updateSoundUi();
  showUploadStatus("Som ativado neste dispositivo.");
}

function resolveDrawnAudio(state) {
  if (!state) return null;
  if (state.drawnAudio?.url) return state.drawnAudio;
  const id = state.drawnAudioId;
  if (!id) return null;
  const record = cachedRecords.find((row) => row.id === id);
  if (!record) return null;
  return {
    id: record.id,
    name: getDisplayName(record),
    url: record.url
  };
}

function pickDurationMs() {
  const unit = timerUnitSelect.value;
  const multiplier = unit === "minutes" ? 60_000 : 1_000;
  let min = Number(timerAmountMinInput?.value);
  let max = Number(timerAmountMaxInput?.value);
  if (!Number.isFinite(min) || min <= 0) min = 1;
  if (!Number.isFinite(max) || max <= 0) max = min;
  if (max < min) [min, max] = [max, min];
  const amount = min === max ? min : min + Math.random() * (max - min);
  return Math.round(amount * multiplier);
}

async function refreshHistory() {
  if (!playHistoryList) return;
  try {
    const rows = await listPlayHistory({ limit: 20 });
    playHistoryList.innerHTML = "";
    if (!rows.length) {
      const empty = document.createElement("li");
      empty.className = "history-empty";
      empty.textContent = "Nenhum toque registrado ainda.";
      playHistoryList.appendChild(empty);
      return;
    }
    for (const row of rows) {
      const li = document.createElement("li");
      li.textContent = `${row.audio_name || "audio"} — ${formatDate(row.played_at)}`;
      playHistoryList.appendChild(li);
    }
  } catch (error) {
    playHistoryList.innerHTML = "";
    const li = document.createElement("li");
    li.className = "history-empty";
    li.textContent = "Histórico indisponível no momento.";
    playHistoryList.appendChild(li);
  }
}

function playDrawnFromRoomState(state, { notify = true } = {}) {
  const revision = Number(state?.revision);
  if (Number.isFinite(revision) && revision <= playedRevision) return false;
  const drawn = resolveDrawnAudio(state);
  if (!drawn?.url) {
    timerStateLabel.textContent = "Sem áudios para tocar";
    isTimerRunning = false;
    releaseWakeLock();
    updateUiLock();
    showSetupScreen();
    return false;
  }

  if (Number.isFinite(revision)) playedRevision = revision;
  isTimerRunning = false;
  isTimerPaused = false;
  updateUiLock();
  setRingProgress(100);
  timeRemainingLabel.textContent = "00:00";
  showTimerScreen();

  if (notify && timerNotify?.checked) {
    notifyTimerEnded("Nostrabot", "O timer terminou — tocando o áudio da sala.");
  }

  if (!soundUnlocked) {
    timerStateLabel.textContent = "Ative o som para ouvir";
    showPlayFallback(drawn.url, () => {
      markRoomPlayStart(drawn);
    });
    updateSoundUi();
    return true;
  }

  timerStateLabel.textContent = "Tocando...";
  playUrl(drawn.url, {
    allowFallback: true,
    onPlayStart: () => markRoomPlayStart(drawn)
  });
  return true;
}

function markRoomPlayStart(drawn) {
  soundUnlocked = true;
  updateSoundUi();
  const record = cachedRecords.find((row) => row.id === drawn.id);
  if (record) {
    audioWeights = recordRandomPlay(drawn.url, cachedRecords, audioWeights);
    renderAudioWeights(audioWeights);
  }
  recordPlayEvent({
    audioId: drawn.id,
    audioName: drawn.name || getDisplayName(record) || "audio",
    audioUrl: drawn.url,
    roomId: currentRoomCode
  }).then(() => refreshHistory());
}

async function maybeStartRoomRepeat() {
  if (!currentRoomCode || roomRepeatInFlight) return;
  const autoRepeat =
    latestRoomState?.autoRepeat ?? Boolean(timerAutoRepeat?.checked);
  if (!autoRepeat) {
    showSetupScreen();
    return;
  }
  roomRepeatInFlight = true;
  try {
    await syncServerClock();
    const durationMs = pickDurationMs();
    const room = await startRoomTimer(currentRoomCode, durationMs, {
      autoRepeat: true,
      noRepeatUntilAll: Boolean(
        latestRoomState?.noRepeatUntilAll ?? timerNoRepeat?.checked
      )
    });
    latestRoomState = room.state || latestRoomState;
    noteRoomRevision(currentRoomCode, room.state?.revision);
    const endAt = new Date(room.state.endsAt).getTime();
    const duration = Number(room.state.durationMs) || durationMs;
    startCountdown(duration, { endAt, durationMs: duration });
  } catch (error) {
    console.warn("Falha ao repetir timer da sala:", error);
    showSetupScreen();
  } finally {
    roomRepeatInFlight = false;
  }
}

function handleTimerComplete() {
  const countdown = activeCountdown;
  if (!countdown) return;
  activeCountdown = null;
  clearActiveTimerStorage();
  if (countdown.intervalId) clearInterval(countdown.intervalId);
  if (countdown.timeoutId) clearTimeout(countdown.timeoutId);

  isTimerPaused = false;

  // Room clients never draw locally — play the server-drawn audio.
  if (currentRoomCode) {
    playDrawnFromRoomState(latestRoomState, { notify: true });
    return;
  }

  pendingAutoRepeat = Boolean(timerAutoRepeat?.checked);

  if (timerNotify?.checked) {
    notifyTimerEnded("Nostrabot", "O timer terminou — sorteando um áudio.");
  }

  const chosen = drawWeightedRecord(cachedRecords, audioWeights, {
    noRepeatUntilAll: Boolean(timerNoRepeat?.checked)
  });
  if (!chosen) {
    timerStateLabel.textContent = "Sem áudios para tocar";
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
      audioWeights = recordRandomPlay(chosen.url, cachedRecords, audioWeights);
      renderAudioWeights(audioWeights);
      recordPlayEvent({
        audioId: chosen.id,
        audioName: getDisplayName(chosen),
        audioUrl: chosen.url,
        roomId: null
      }).then(() => refreshHistory());
    }
  });
}

function startCountdown(durationMs, resumeState = null) {
  if (activeCountdown?.timeoutId) clearTimeout(activeCountdown.timeoutId);
  if (activeCountdown?.intervalId) clearInterval(activeCountdown.intervalId);

  const startAt = currentRoomCode ? serverNowMs() : Date.now();
  const endAt = resumeState?.endAt ?? startAt + durationMs;
  const totalDurationMs = resumeState?.durationMs ?? durationMs;
  const remainingMs = Math.max(0, endAt - startAt);
  isTimerRunning = true;
  isTimerPaused = false;
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
    remainingMs,
    intervalId,
    timeoutId
  };
  persistActiveTimer();
  updateCountdownUi();
}

function pauseTimer() {
  if (!activeCountdown || isTimerPaused || isAudioPlaying) return;
  // In a room, only the host should pause via shared state — keep local+remote in sync.
  const now = currentRoomCode ? serverNowMs() : Date.now();
  const remaining = Math.max(0, activeCountdown.endAt - now);
  if (activeCountdown.timeoutId) clearTimeout(activeCountdown.timeoutId);
  if (activeCountdown.intervalId) clearInterval(activeCountdown.intervalId);
  activeCountdown.remainingMs = remaining;
  activeCountdown.timeoutId = null;
  activeCountdown.intervalId = null;
  isTimerPaused = true;
  isTimerRunning = false;
  timerStateLabel.textContent = "Pausado";
  releaseWakeLock();
  updateUiLock();
  if (currentRoomCode && !applyingRemoteState) {
    setRoomState(currentRoomCode, {
      status: "paused",
      remainingMs: remaining,
      durationMs: activeCountdown.durationMs,
      endsAt: null,
      drawnAudioId: latestRoomState?.drawnAudioId ?? null,
      drawnAudio: latestRoomState?.drawnAudio ?? null,
      nextDrawnAudioId: latestRoomState?.nextDrawnAudioId ?? null,
      nextDrawnAudio: latestRoomState?.nextDrawnAudio ?? null,
      autoRepeat: latestRoomState?.autoRepeat ?? Boolean(timerAutoRepeat?.checked),
      noRepeatUntilAll:
        latestRoomState?.noRepeatUntilAll ?? Boolean(timerNoRepeat?.checked)
    }).catch((error) => console.warn(error));
  }
}

function resumeTimer() {
  if (!activeCountdown || !isTimerPaused) return;
  const remaining = activeCountdown.remainingMs ?? 0;
  const endAt = (currentRoomCode ? serverNowMs() : Date.now()) + remaining;
  startCountdown(activeCountdown.durationMs, {
    endAt,
    durationMs: activeCountdown.durationMs
  });
  if (currentRoomCode && !applyingRemoteState) {
    setRoomState(currentRoomCode, {
      status: "running",
      remainingMs: null,
      durationMs: activeCountdown.durationMs,
      endsAt: new Date(endAt).toISOString(),
      drawnAudioId: latestRoomState?.drawnAudioId ?? null,
      drawnAudio: latestRoomState?.drawnAudio ?? null,
      nextDrawnAudioId: latestRoomState?.nextDrawnAudioId ?? null,
      nextDrawnAudio: latestRoomState?.nextDrawnAudio ?? null,
      autoRepeat: latestRoomState?.autoRepeat ?? Boolean(timerAutoRepeat?.checked),
      noRepeatUntilAll:
        latestRoomState?.noRepeatUntilAll ?? Boolean(timerNoRepeat?.checked)
    }).catch((error) => console.warn(error));
  }
}

function applyRemoteRoomState(row) {
  if (!row?.state) return;
  const state = row.state;
  const isSameRevision = Boolean(row._sameRevision);

  if (!isSameRevision) {
    latestRoomState = state;
  }

  applyingRemoteState = true;
  try {
    const endsAtRaw = state.endsAt || state.ends_at;
    const durationMs =
      Number(state.durationMs ?? state.duration_ms) || 0;
    const remainingMs = state.remainingMs ?? state.remaining_ms;

    if (state.status === "idle") {
      if (!isAudioPlaying && (isTimerRunning || isTimerPaused)) {
        stopCountdown("Sala ociosa");
        isTimerRunning = false;
        isTimerPaused = false;
        updateUiLock();
        showSetupScreen();
      }
      return;
    }

    if (state.status === "running" && endsAtRaw) {
      const endAt = new Date(endsAtRaw).getTime();
      if (!Number.isFinite(endAt)) return;
      const now = serverNowMs();
      // Server-anchored: when endsAt is reached, play drawnAudioId (no local draw).
      if (endAt <= now) {
        if (!isAudioPlaying) {
          playDrawnFromRoomState(state, { notify: !isSameRevision });
        }
        return;
      }
      const dur = durationMs || Math.max(1000, endAt - now);
      if (
        !isSameRevision ||
        !isTimerRunning ||
        Math.abs((activeCountdown?.endAt || 0) - endAt) > 750
      ) {
        startCountdown(dur, { endAt, durationMs: dur });
      }
      return;
    }

    if (state.status === "paused" && remainingMs != null) {
      if (activeCountdown?.timeoutId) clearTimeout(activeCountdown.timeoutId);
      if (activeCountdown?.intervalId) clearInterval(activeCountdown.intervalId);
      activeCountdown = {
        durationMs: durationMs || Number(remainingMs),
        endAt: serverNowMs() + Number(remainingMs),
        remainingMs: Number(remainingMs),
        intervalId: null,
        timeoutId: null
      };
      isTimerPaused = true;
      isTimerRunning = false;
      showTimerScreen();
      timerStateLabel.textContent = "Pausado";
      timeRemainingLabel.textContent = toRemainingLabel(Number(remainingMs));
      updateUiLock();
    }
  } finally {
    applyingRemoteState = false;
  }
}

async function joinRoom(code) {
  const room = await getRoom(code);
  currentRoomCode = room.code;
  latestRoomState = room.state || null;
  playedRevision = -1;
  noteRoomRevision(room.code, room.state?.revision);
  setRoomInLocation(room.code);
  updateRoomUi();
  if (unsubRoom) unsubRoom();
  unsubRoom = subscribeRoom(room.code, (row) => applyRemoteRoomState(row));
  applyRemoteRoomState(room);
  showUploadStatus(
    soundUnlocked
      ? `Entrou na sala ${room.code}.`
      : `Entrou na sala ${room.code}. Ative o som neste dispositivo.`
  );
}

function createProgressRow(label) {
  const row = document.createElement("div");
  row.className = "upload-progress-item";
  const title = document.createElement("div");
  title.className = "upload-progress-label";
  title.textContent = label;
  const bar = document.createElement("div");
  bar.className = "upload-progress-bar";
  const fill = document.createElement("div");
  fill.className = "upload-progress-fill";
  bar.appendChild(fill);
  row.append(title, bar);
  uploadProgressList.hidden = false;
  uploadProgressList.appendChild(row);
  return {
    set(value) {
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
    },
    done(ok) {
      row.classList.toggle("is-error", !ok);
      row.classList.toggle("is-done", ok);
    }
  };
}

async function uploadMany(files) {
  const list = Array.from(files || []);
  if (!list.length) {
    showUploadStatus("Escolha ao menos um arquivo de áudio.", true);
    return;
  }

  saveButton.disabled = true;
  uploadProgressList.innerHTML = "";
  uploadProgressList.hidden = false;

  try {
    for (let i = 0; i < list.length; i += 1) {
      const file = list[i];
      const progress = createProgressRow(`${i + 1}/${list.length} — ${file.name}`);
      showUploadStatus(`Enviando ${i + 1} de ${list.length}...`);
      try {
        await uploadAudioFile(file, {
          onProgress: ({ stage, value }) => {
            const base = stage === "compress" ? 0 : 0.45;
            const span = stage === "compress" ? 0.45 : 0.55;
            progress.set(base + value * span);
          }
        });
        progress.set(1);
        progress.done(true);
      } catch (error) {
        progress.done(false);
        throw error;
      }
    }
    if (audioInput) audioInput.value = "";
    showUploadStatus(`${list.length} arquivo(s) salvo(s) com sucesso.`);
    await refreshList();
  } catch (error) {
    console.error(error);
    showUploadStatus(error?.message || "Erro ao salvar os arquivos.", true);
  } finally {
    saveButton.disabled = false;
  }
}

function buildAudioItem(record) {
  const li = document.createElement("li");
  li.className = "audio-item";

  const icon = document.createElement("div");
  icon.className = "audio-icon";
  icon.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "audio-body";

  const header = document.createElement("div");
  header.className = "audio-header";

  const name = document.createElement("h3");
  name.className = "audio-name";
  name.textContent = getDisplayName(record);
  name.title = getDisplayName(record);

  const weightBadge = document.createElement("span");
  weightBadge.className = "audio-weight";
  weightBadge.dataset.audioWeight = record.url;
  weightBadge.textContent = `peso ${audioWeights[record.url] ?? record.weight ?? 1}`;

  header.append(name, weightBadge);

  const meta = document.createElement("div");
  meta.className = "audio-meta";
  const size = document.createElement("span");
  size.className = "audio-meta-item";
  size.textContent = formatBytes(record.size);
  const date = document.createElement("span");
  date.className = "audio-meta-item";
  date.textContent = showingTrash
    ? `Excluído em ${formatDate(record.deletedAt)}`
    : `Salvo em ${formatDate(record.uploadedAt)}`;
  meta.append(size, date);

  if (record.description) {
    const desc = document.createElement("p");
    desc.className = "audio-description";
    desc.textContent = record.description;
    body.append(header, desc, meta);
  } else {
    body.append(header, meta);
  }

  const actions = document.createElement("div");
  actions.className = "audio-actions";

  if (showingTrash) {
    const restoreButton = document.createElement("button");
    restoreButton.className = "secondary audio-action-btn";
    restoreButton.dataset.role = "restore";
    restoreButton.textContent = "Restaurar";
    restoreButton.addEventListener("click", async () => {
      restoreButton.disabled = true;
      try {
        await restoreAudioRecord(record.id);
        showUploadStatus("Áudio restaurado.");
        await refreshList();
      } catch (error) {
        showUploadStatus(error.message || "Erro ao restaurar.", true);
        restoreButton.disabled = false;
      }
    });
    actions.append(restoreButton);
  } else {
    const playNowButton = document.createElement("button");
    playNowButton.className = "secondary audio-action-btn";
    playNowButton.dataset.role = "play";
    playNowButton.textContent = "Tocar";
    playNowButton.addEventListener("click", () => {
      if (isTimerRunning || isAudioPlaying) return;
      clearSetupFeedback();
      playUrl(record.url);
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "danger audio-action-btn";
    deleteButton.dataset.role = "delete";
    deleteButton.textContent = "Excluir";
    deleteButton.addEventListener("click", async () => {
      const displayName = getDisplayName(record);
      const confirmed = window.confirm(`Mover "${displayName}" para a lixeira?`);
      if (!confirmed) return;
      deleteButton.disabled = true;
      try {
        await deleteAudioRecord(record.id);
        showToast(`"${displayName}" na lixeira.`, {
          actionLabel: "Desfazer",
          onAction: async () => {
            try {
              await restoreAudioRecord(record.id);
              await refreshList();
              showUploadStatus("Exclusão desfeita.");
            } catch (error) {
              showUploadStatus(error.message || "Falha ao desfazer.", true);
            }
          }
        });
        await refreshList();
      } catch (error) {
        showUploadStatus(error.message || "Erro ao excluir áudio.", true);
        deleteButton.disabled = false;
      }
    });

    actions.append(playNowButton, deleteButton);
  }

  li.append(icon, body, actions);
  return li;
}

async function refreshList() {
  try {
    const records = await getAllAudioRecords({
      query: searchQuery,
      trashed: showingTrash
    });
    if (listHint) {
      listHint.textContent = showingTrash
        ? "Itens na lixeira podem ser restaurados por até 30 dias."
        : "O peso define a chance no sorteio. Itens excluídos ficam 30 dias na lixeira.";
    }

    records.sort((a, b) => {
      const aTime = new Date(showingTrash ? a.deletedAt : a.uploadedAt).getTime();
      const bTime = new Date(showingTrash ? b.deletedAt : b.uploadedAt).getTime();
      return bTime - aTime;
    });

    cachedRecords = showingTrash ? [] : records;
    if (!showingTrash) {
      const seeded = {};
      for (const record of records) {
        seeded[record.url] = record.weight ?? 1;
      }
      audioWeights = syncAudioWeights(records);
      for (const record of records) {
        if (seeded[record.url] != null) {
          audioWeights[record.url] = Math.max(
            audioWeights[record.url] ?? 1,
            seeded[record.url]
          );
        }
      }
    }

    audioList.innerHTML = "";
    if (audioDropdownSummary) {
      audioDropdownSummary.textContent = String(records.length);
    }

    if (records.length === 0) {
      const empty = document.createElement("li");
      empty.className = "audio-item audio-item--empty";
      empty.textContent = showingTrash
        ? "Lixeira vazia."
        : "Nenhum áudio ainda.";
      audioList.appendChild(empty);
      updateUiLock();
      return;
    }

    records.forEach((record) => audioList.appendChild(buildAudioItem(record)));
    updateUiLock();
  } catch (error) {
    cachedRecords = [];
    audioList.innerHTML = "";
    const empty = document.createElement("li");
    empty.className = "audio-item audio-item--empty";
    empty.textContent = "Não foi possível carregar a biblioteca.";
    audioList.appendChild(empty);
    if (audioDropdownSummary) audioDropdownSummary.textContent = "0";
    showUploadStatus(error.message || "Erro ao listar áudios.", true);
  }
}

async function startRandomTimer() {
  clearSetupFeedback();
  const min = Number(timerAmountMinInput?.value);
  const max = Number(timerAmountMaxInput?.value);
  if (!Number.isFinite(min) || min <= 0 || !Number.isFinite(max) || max <= 0) {
    showSetupFeedback("Informe um intervalo válido (mín/máx).");
    return;
  }
  if (!cachedRecords.length) {
    showSetupFeedback("Nenhum áudio salvo.");
    return;
  }
  const unit = timerUnitSelect.value;
  saveTimerPrefs({
    min,
    max,
    unit,
    autoRepeat: Boolean(timerAutoRepeat?.checked),
    noRepeat: Boolean(timerNoRepeat?.checked),
    notify: Boolean(timerNotify?.checked)
  });
  if (timerNotify?.checked) {
    await ensureNotificationPermission();
  }
  const durationMs = pickDurationMs();
  if (currentRoomCode) {
    await syncServerClock();
    const room = await startRoomTimer(currentRoomCode, durationMs, {
      autoRepeat: Boolean(timerAutoRepeat?.checked),
      noRepeatUntilAll: Boolean(timerNoRepeat?.checked)
    });
    latestRoomState = room.state || null;
    playedRevision = -1;
    noteRoomRevision(currentRoomCode, room.state?.revision);
    const endAt = new Date(room.state.endsAt).getTime();
    const dur = Number(room.state.durationMs) || durationMs;
    startCountdown(dur, { endAt, durationMs: dur });
    return;
  }
  startCountdown(durationMs);
}

function cancelRandomTimer() {
  if (!activeCountdown && !isAudioPlaying && !isTimerPaused) return;
  pendingAutoRepeat = false;
  roomRepeatInFlight = false;
  isTimerRunning = false;
  isTimerPaused = false;
  cleanupActiveAudio();
  isAudioPlaying = false;
  releaseWakeLock();
  hidePlayFallback();
  updateUiLock();
  if (activeCountdown) stopCountdown("Timer cancelado");
  if (currentRoomCode) {
    cancelRoomTimer(currentRoomCode).catch((error) => console.warn(error));
  }
  showSetupScreen();
}

function handleChangeAdminKey() {
  const key = ensureAdminKey({ forcePrompt: true });
  if (!key) {
    showUploadStatus("Chave de admin removida deste dispositivo.", true);
    return;
  }
  showUploadStatus("Chave de admin salva neste dispositivo.");
}

async function resumeTimerIfStored() {
  // Room members follow server state via subscribeRoom — never draw locally.
  if (currentRoomCode) {
    clearActiveTimerStorage();
    return;
  }
  const stored = loadActiveTimer();
  if (!stored) return;
  const remaining = stored.endAt - Date.now();
  if (remaining > 0) {
    startCountdown(remaining, {
      endAt: stored.endAt,
      durationMs: stored.durationMs
    });
    return;
  }
  clearActiveTimerStorage();
  if (!cachedRecords.length) return;
  showTimerScreen();
  timerStateLabel.textContent = "Timer encerrado";
  const chosen = drawWeightedRecord(cachedRecords, audioWeights, {
    noRepeatUntilAll: Boolean(timerNoRepeat?.checked)
  });
  if (!chosen) return;
  playUrl(chosen.url, {
    allowFallback: true,
    onPlayStart: () => {
      audioWeights = recordRandomPlay(chosen.url, cachedRecords, audioWeights);
      renderAudioWeights(audioWeights);
      recordPlayEvent({
        audioId: chosen.id,
        audioName: getDisplayName(chosen),
        audioUrl: chosen.url,
        roomId: null
      }).then(() => refreshHistory());
    }
  });
}

function wireDropZone() {
  if (!dropZone) return;
  const highlight = (on) => dropZone.classList.toggle("is-dragover", on);
  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      highlight(true);
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      highlight(false);
    });
  });
  dropZone.addEventListener("drop", (event) => {
    const files = event.dataTransfer?.files;
    if (files?.length) uploadMany(files);
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
    wireDropZone();

    saveButton.addEventListener("click", () => uploadMany(audioInput.files));
    if (changeAdminKeyButton) {
      changeAdminKeyButton.addEventListener("click", handleChangeAdminKey);
    }
    startRandomTimerButton.addEventListener("click", () => {
      startRandomTimer().catch((error) => {
        showSetupFeedback(
          friendlyUserError(error, "Falha ao iniciar o timer.")
        );
      });
    });
    cancelRandomTimerButton.addEventListener("click", cancelRandomTimer);
    if (pauseResumeTimerButton) {
      pauseResumeTimerButton.addEventListener("click", () => {
        if (isTimerPaused) resumeTimer();
        else pauseTimer();
      });
    }

    if (audioSearch) {
      let searchTimer;
      audioSearch.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          searchQuery = audioSearch.value || "";
          refreshList().catch((error) => {
            showUploadStatus(error.message || "Falha na busca.", true);
          });
        }, 200);
      });
    }

    if (trashToggleButton) {
      trashToggleButton.addEventListener("click", async () => {
        showingTrash = !showingTrash;
        trashToggleButton.textContent = showingTrash ? "Biblioteca" : "Lixeira";
        await refreshList();
      });
    }


    const recorder = createMicRecorder({
      onStop: (file) => {
        recordButton.textContent = "Gravar microfone";
        uploadMany([file]);
      },
      onError: (error) => {
        recordButton.textContent = "Gravar microfone";
        showUploadStatus(error?.message || "Falha no microfone.", true);
      }
    });

    if (recordButton) {
      recordButton.addEventListener("click", async () => {
        try {
          if (recorder.isRecording()) {
            recorder.stop();
            recordButton.textContent = "Gravar microfone";
            return;
          }
          await recorder.start();
          recordButton.textContent = "Parar gravação";
          showUploadStatus("Gravando do microfone...");
        } catch (error) {
          showUploadStatus(
            error?.message || "Permissão de microfone negada.",
            true
          );
        }
      });
    }

    if (playFallbackButton) {
      playFallbackButton.addEventListener("click", () => {
        if (!pendingPlay) return;
        const { url, onPlayStart } = pendingPlay;
        playUrl(url, { allowFallback: true, onPlayStart });
      });
    }

    if (enableSoundButton) {
      enableSoundButton.addEventListener("click", () => {
        unlockSound().catch(() => {});
      });
    }

    if (createRoomButton) {
      createRoomButton.addEventListener("click", async () => {
        createRoomButton.disabled = true;
        try {
          const room = await createRoom("Sala Nostrabot");
          currentRoomCode = room.code;
          latestRoomState = room.state || null;
          playedRevision = -1;
          noteRoomRevision(room.code, room.state?.revision);
          setRoomInLocation(room.code);
          updateRoomUi();
          if (unsubRoom) unsubRoom();
          unsubRoom = subscribeRoom(room.code, (row) => applyRemoteRoomState(row));
          showUploadStatus(
            soundUnlocked
              ? `Sala ${room.code} criada. Compartilhe o link.`
              : `Sala ${room.code} criada. Ative o som neste dispositivo.`
          );
        } catch (error) {
          showUploadStatus(error.message || "Falha ao criar sala.", true);
        } finally {
          createRoomButton.disabled = false;
        }
      });
    }

    if (copyRoomLinkButton) {
      copyRoomLinkButton.addEventListener("click", async () => {
        if (!currentRoomCode) return;
        const link = `${window.location.origin}${window.location.pathname}?room=${currentRoomCode}`;
        try {
          await navigator.clipboard.writeText(link);
          showUploadStatus("Link da sala copiado.");
        } catch (error) {
          showUploadStatus(link);
        }
      });
    }

    await refreshList();
    await refreshHistory();
    await syncServerClock();
    updateRoomUi();

    const initialRoom = getRoomCodeFromLocation();
    if (initialRoom) {
      try {
        await joinRoom(initialRoom);
      } catch (error) {
        showUploadStatus(error.message || "Não foi possível entrar na sala.", true);
      }
    }

    await resumeTimerIfStored();
    timerStateLabel.textContent = "Aguardando";
    updateUiLock();
  } catch (error) {
    console.error(error);
    showUploadStatus(
      error?.message || "Erro ao carregar a lista de áudios. Recarregue a página.",
      true
    );
  }
}

init();
