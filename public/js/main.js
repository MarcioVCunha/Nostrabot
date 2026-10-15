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
  createRoom,
  getRoom,
  getRoomCodeFromLocation,
  serverNowMs,
  setRoomInLocation,
  setRoomState,
  startRoomTimer,
  subscribeRoom,
  syncServerClock
} from "./rooms.js";
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
}

async function publishRoomState(partial) {
  if (!currentRoomCode || applyingRemoteState) return;
  try {
    await setRoomState(currentRoomCode, partial);
  } catch (error) {
    console.warn("Falha ao sincronizar sala:", error);
  }
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

function handleTimerComplete() {
  const countdown = activeCountdown;
  if (!countdown) return;
  activeCountdown = null;
  clearActiveTimerStorage();
  if (countdown.intervalId) clearInterval(countdown.intervalId);
  if (countdown.timeoutId) clearTimeout(countdown.timeoutId);

  isTimerPaused = false;
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
    publishRoomState({ status: "idle", ends_at: null, drawn_audio: null });
    showSetupScreen();
    return;
  }

  isTimerRunning = false;
  updateUiLock();
  setRingProgress(100);
  timeRemainingLabel.textContent = "00:00";
  timerStateLabel.textContent = "Tocando...";

  publishRoomState({
    status: "playing",
    ends_at: null,
    drawn_audio: {
      id: chosen.id,
      name: getDisplayName(chosen),
      url: chosen.url
    }
  });

  playUrl(chosen.url, {
    allowFallback: true,
    onPlayStart: () => {
      audioWeights = recordRandomPlay(chosen.url, cachedRecords, audioWeights);
      renderAudioWeights(audioWeights);
      recordPlayEvent({
        audioId: chosen.id,
        audioName: getDisplayName(chosen),
        audioUrl: chosen.url,
        roomId: currentRoomCode
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
  publishRoomState({
    status: "paused",
    remaining_ms: remaining,
    duration_ms: activeCountdown.durationMs,
    ends_at: null
  });
}

function resumeTimer() {
  if (!activeCountdown || !isTimerPaused) return;
  const remaining = activeCountdown.remainingMs ?? 0;
  const endAt = (currentRoomCode ? serverNowMs() : Date.now()) + remaining;
  startCountdown(activeCountdown.durationMs, {
    endAt,
    durationMs: activeCountdown.durationMs
  });
  publishRoomState({
    status: "running",
    remaining_ms: null,
    duration_ms: activeCountdown.durationMs,
    ends_at: new Date(endAt).toISOString()
  });
}

function applyRemoteRoomState(row) {
  if (!row?.state) return;
  applyingRemoteState = true;
  try {
    const state = row.state;
    if (state.status === "running" && state.ends_at) {
      const endAt = new Date(state.ends_at).getTime();
      const durationMs = Number(state.duration_ms) || Math.max(1000, endAt - serverNowMs());
      if (!isTimerRunning || Math.abs((activeCountdown?.endAt || 0) - endAt) > 750) {
        startCountdown(durationMs, { endAt, durationMs });
      }
      return;
    }
    if (state.status === "paused" && state.remaining_ms != null) {
      if (activeCountdown?.timeoutId) clearTimeout(activeCountdown.timeoutId);
      if (activeCountdown?.intervalId) clearInterval(activeCountdown.intervalId);
      activeCountdown = {
        durationMs: Number(state.duration_ms) || state.remaining_ms,
        endAt: serverNowMs() + Number(state.remaining_ms),
        remainingMs: Number(state.remaining_ms),
        intervalId: null,
        timeoutId: null
      };
      isTimerPaused = true;
      isTimerRunning = false;
      showTimerScreen();
      timerStateLabel.textContent = "Pausado";
      timeRemainingLabel.textContent = toRemainingLabel(Number(state.remaining_ms));
      updateUiLock();
      return;
    }
    if (state.status === "playing" && state.drawn_audio?.url && !isAudioPlaying) {
      isTimerRunning = false;
      isTimerPaused = false;
      showTimerScreen();
      playUrl(state.drawn_audio.url, { allowFallback: true });
    }
  } finally {
    applyingRemoteState = false;
  }
}

async function joinRoom(code) {
  const room = await getRoom(code);
  currentRoomCode = room.code;
  setRoomInLocation(room.code);
  updateRoomUi();
  if (unsubRoom) unsubRoom();
  unsubRoom = subscribeRoom(room.code, (row) => applyRemoteRoomState(row));
  applyRemoteRoomState(room);
  showUploadStatus(`Entrou na sala ${room.code}.`);
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
    const room = await startRoomTimer(currentRoomCode, durationMs);
    const endAt = new Date(room.state.ends_at).getTime();
    startCountdown(durationMs, { endAt, durationMs });
    return;
  }
  startCountdown(durationMs);
}

function cancelRandomTimer() {
  if (!activeCountdown && !isAudioPlaying && !isTimerPaused) return;
  pendingAutoRepeat = false;
  isTimerRunning = false;
  isTimerPaused = false;
  cleanupActiveAudio();
  isAudioPlaying = false;
  releaseWakeLock();
  hidePlayFallback();
  updateUiLock();
  if (activeCountdown) stopCountdown("Timer cancelado");
  publishRoomState({
    status: "idle",
    ends_at: null,
    remaining_ms: null,
    drawn_audio: null
  });
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
        showSetupFeedback(error.message || "Falha ao iniciar timer.");
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

    if (createRoomButton) {
      createRoomButton.addEventListener("click", async () => {
        createRoomButton.disabled = true;
        try {
          const room = await createRoom("Sala Nostrabot");
          currentRoomCode = room.code;
          setRoomInLocation(room.code);
          updateRoomUi();
          if (unsubRoom) unsubRoom();
          unsubRoom = subscribeRoom(room.code, (row) => applyRemoteRoomState(row));
          showUploadStatus(`Sala ${room.code} criada. Compartilhe o link.`);
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
