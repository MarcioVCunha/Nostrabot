import { ensureAdminKey } from "./admin-key.js";
import {
  deleteAudioRecord,
  getAllAudioRecords,
  restoreAudioRecord,
  uploadAudioFile
} from "./api.js";
import { drawWeightedRecord } from "./draw.js";
import { formatDate, getDisplayName } from "./format.js";
import { listPlayHistory, recordPlayEvent } from "./history.js";
import {
  ensureNotificationPermission,
  notifyTimerEnded
} from "./notifications.js";
import { createMicRecorder } from "./recorder.js";
import { friendlyUserError } from "./errors.js";
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
const timerIdleControls = document.getElementById("timerIdleControls");
const timerRunControls = document.getElementById("timerRunControls");
const timerAmountInput = document.getElementById("timerAmount");
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
  if (timerAmountInput) timerAmountInput.disabled = locked || isTimerPaused;
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

function showActiveControls() {
  if (timerIdleControls) timerIdleControls.hidden = true;
  if (timerRunControls) timerRunControls.hidden = false;
  if (appShell) appShell.classList.add("is-timing");
}

function showIdleControls() {
  if (timerRunControls) timerRunControls.hidden = true;
  if (timerIdleControls) timerIdleControls.hidden = false;
  if (appShell) appShell.classList.remove("is-timing");
  hidePlayFallback();
  refreshIdlePreview();
}

function configuredDurationMs() {
  const unit = timerUnitSelect?.value || "seconds";
  const multiplier = unit === "minutes" ? 60_000 : 1_000;
  let amount = Number(timerAmountInput?.value);
  if (!Number.isFinite(amount) || amount <= 0) amount = 1;
  return Math.round(amount * multiplier);
}

function refreshIdlePreview() {
  if (isTimerRunning || isTimerPaused || isAudioPlaying || activeCountdown) return;
  setRingProgress(0);
  timeRemainingLabel.textContent = toRemainingLabel(configuredDurationMs());
  if (timerStateLabel) timerStateLabel.textContent = "Pronto";
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
  const amount =
    prefs.amount != null
      ? prefs.amount
      : prefs.min != null
        ? prefs.min
        : null;
  if (amount != null && timerAmountInput) timerAmountInput.value = amount;
  if (prefs.unit === "seconds" || prefs.unit === "minutes") {
    timerUnitSelect.value = prefs.unit;
  }
  if (timerAutoRepeat) timerAutoRepeat.checked = Boolean(prefs.autoRepeat);
  if (timerNoRepeat) timerNoRepeat.checked = Boolean(prefs.noRepeat);
  if (timerNotify) timerNotify.checked = prefs.notify !== false;
  refreshIdlePreview();
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
        startCountdown(configuredDurationMs());
        return;
      }
      showIdleControls();
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
      showIdleControls();
    },
    { once: true }
  );

  activeAudio.play().catch((error) => {
    console.error(error);
    isAudioPlaying = false;
    activeAudio = null;
    updateUiLock();
    if (allowFallback) {
      showActiveControls();
      showPlayFallback(url, onPlayStart);
      return;
    }
    showUploadStatus(
      "Não foi possível reproduzir automaticamente. Tente novamente.",
      true
    );
    showIdleControls();
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
  refreshIdlePreview();
}

function updateCountdownUi() {
  if (!activeCountdown) return;
  const now = Date.now();
  const remaining = Math.max(0, activeCountdown.endAt - now);
  const elapsed = activeCountdown.durationMs - remaining;
  const percent = (elapsed / activeCountdown.durationMs) * 100;
  setRingProgress(percent);
  timeRemainingLabel.textContent = toRemainingLabel(remaining);
  if (remaining <= 0 && isTimerRunning) handleTimerComplete();
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
    showIdleControls();
    return;
  }

  isTimerRunning = false;
  updateUiLock();
  setRingProgress(100);
  timeRemainingLabel.textContent = "00:00";
  timerStateLabel.textContent = "Tocando...";
  showActiveControls();

  playUrl(chosen.url, {
    allowFallback: true,
    onPlayStart: () => {
      audioWeights = recordRandomPlay(chosen.url, cachedRecords, audioWeights);
      renderAudioWeights(audioWeights);
      recordPlayEvent({
        audioId: chosen.id,
        audioName: getDisplayName(chosen),
        audioUrl: chosen.url
      }).then(() => refreshHistory());
    }
  });
}

function startCountdown(durationMs, resumeState = null) {
  if (activeCountdown?.timeoutId) clearTimeout(activeCountdown.timeoutId);
  if (activeCountdown?.intervalId) clearInterval(activeCountdown.intervalId);

  const startAt = Date.now();
  const endAt = resumeState?.endAt ?? startAt + durationMs;
  const totalDurationMs = resumeState?.durationMs ?? durationMs;
  const remainingMs = Math.max(0, endAt - startAt);
  isTimerRunning = true;
  isTimerPaused = false;
  updateUiLock();
  showActiveControls();
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
  const now = Date.now();
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
}

function resumeTimer() {
  if (!activeCountdown || !isTimerPaused) return;
  const remaining = activeCountdown.remainingMs ?? 0;
  const endAt = Date.now() + remaining;
  startCountdown(activeCountdown.durationMs, {
    endAt,
    durationMs: activeCountdown.durationMs
  });
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
  weightBadge.textContent = String(audioWeights[record.url] ?? record.weight ?? 1);
  weightBadge.title = `Peso ${weightBadge.textContent}`;

  header.append(name, weightBadge);
  body.append(header);

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

  li.append(body, actions);
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
        ? "Lixeira: restaurar em até 30 dias."
        : "Número = peso no sorteio.";
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
  const amount = Number(timerAmountInput?.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showSetupFeedback("Informe um tempo válido.");
    return;
  }
  if (!cachedRecords.length) {
    showSetupFeedback("Nenhum áudio salvo.");
    return;
  }
  const unit = timerUnitSelect.value;
  saveTimerPrefs({
    amount,
    unit,
    autoRepeat: Boolean(timerAutoRepeat?.checked),
    noRepeat: Boolean(timerNoRepeat?.checked),
    notify: Boolean(timerNotify?.checked)
  });
  if (timerNotify?.checked) {
    await ensureNotificationPermission();
  }
  startCountdown(configuredDurationMs());
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
  showIdleControls();
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
  showActiveControls();
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
        audioUrl: chosen.url
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
    showIdleControls();
    applyTimerPrefs();
    wireDropZone();

    saveButton.addEventListener("click", () => uploadMany(audioInput.files));
    if (changeAdminKeyButton) {
      changeAdminKeyButton.addEventListener("click", handleChangeAdminKey);
    }
    const previewInputs = [timerAmountInput, timerUnitSelect];
    for (const input of previewInputs) {
      if (!input) continue;
      input.addEventListener("input", refreshIdlePreview);
      input.addEventListener("change", refreshIdlePreview);
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

    await refreshList();
    await refreshHistory();

    await resumeTimerIfStored();
    if (!isTimerRunning && !isTimerPaused && !isAudioPlaying) {
      refreshIdlePreview();
    }
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
