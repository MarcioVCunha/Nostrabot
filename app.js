const audioInput = document.getElementById("audioInput");
const saveButton = document.getElementById("saveButton");
const uploadStatus = document.getElementById("uploadStatus");
const audioList = document.getElementById("audioList");
const audioDropdownSummary = document.getElementById("audioDropdownSummary");
const themeToggle = document.getElementById("themeToggle");
const timerAmountInput = document.getElementById("timerAmount");
const timerUnitSelect = document.getElementById("timerUnit");
const startRandomTimerButton = document.getElementById("startRandomTimerButton");
const cancelRandomTimerButton = document.getElementById("cancelRandomTimerButton");
const timerProgressRing = document.getElementById("timerProgressRing");
const timeRemainingLabel = document.getElementById("timeRemainingLabel");
const timerStateLabel = document.getElementById("timerStateLabel");

let cachedRecords = [];
let activeCountdown = null;
const ringRadius = 76;
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

if (themeToggle) {
  applyTheme(getPreferredTheme());
  themeToggle.addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    applyTheme(next);
  });
}

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
      "x-content-type": file.type || "audio/mpeg"
    },
    body: file
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
    method: "DELETE"
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Falha ao excluir arquivo.");
  }
}

function playUrl(url) {
  const audio = new Audio(url);
  audio.play().catch((error) => {
    console.error("Erro ao reproduzir audio:", error);
  });
}

function getRandomRecord(records) {
  if (!records.length) return null;
  const idx = Math.floor(Math.random() * records.length);
  return records[idx];
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
  cancelRandomTimerButton.disabled = true;
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
}

function buildAudioItem(record) {
  const li = document.createElement("li");
  li.className = "audio-item";

  const top = document.createElement("div");
  top.className = "audio-top";

  const name = document.createElement("div");
  name.className = "audio-name";
  name.textContent = getDisplayName(record);

  const actions = document.createElement("div");
  actions.className = "row";

  const playNowButton = document.createElement("button");
  playNowButton.className = "secondary";
  playNowButton.textContent = "Reproduzir agora";
  playNowButton.addEventListener("click", () => playUrl(record.url));

  const deleteButton = document.createElement("button");
  deleteButton.className = "danger";
  deleteButton.textContent = "Excluir";
  deleteButton.addEventListener("click", async () => {
    await deleteAudioRecord(record.url);
    await refreshList();
    if (!cachedRecords.length) {
      stopCountdown("Sem audios salvos");
    }
  });

  actions.append(playNowButton, deleteButton);
  top.append(name, actions);

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

  audioList.innerHTML = "";
  if (records.length === 0) {
    if (audioDropdownSummary) audioDropdownSummary.textContent = "Audios salvos (0)";
    const empty = document.createElement("li");
    empty.className = "audio-item";
    empty.textContent = "Nenhum audio salvo ainda.";
    audioList.appendChild(empty);
    return;
  }

  if (audioDropdownSummary) audioDropdownSummary.textContent = `Audios salvos (${records.length})`;
  records.forEach((record) => {
    audioList.appendChild(buildAudioItem(record));
  });
}

function startRandomTimer() {
  const amount = Number(timerAmountInput.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    timerStateLabel.textContent = "Informe um tempo valido";
    return;
  }

  if (!cachedRecords.length) {
    timerStateLabel.textContent = "Nenhum audio salvo";
    return;
  }

  const multiplier = timerUnitSelect.value === "minutes" ? 60_000 : 1_000;
  const durationMs = amount * multiplier;
  const startAt = Date.now();
  const endAt = startAt + durationMs;

  stopCountdown();
  cancelRandomTimerButton.disabled = false;
  timerStateLabel.textContent = "Timer rodando";

  const intervalId = setInterval(updateCountdownUi, 250);
  const timeoutId = setTimeout(() => {
    const chosen = getRandomRecord(cachedRecords);
    if (chosen) {
      playUrl(chosen.url);
      timerStateLabel.textContent = `Tocando: ${getDisplayName(chosen)}`;
    } else {
      timerStateLabel.textContent = "Sem audios para tocar";
    }
    if (activeCountdown?.intervalId) clearInterval(activeCountdown.intervalId);
    activeCountdown = null;
    cancelRandomTimerButton.disabled = true;
    setRingProgress(100);
    timeRemainingLabel.textContent = "00:00";
  }, durationMs);

  activeCountdown = {
    durationMs,
    endAt,
    intervalId,
    timeoutId
  };
  updateCountdownUi();
}

function cancelRandomTimer() {
  if (!activeCountdown) return;
  stopCountdown("Timer cancelado");
}

async function handleSaveFiles() {
  const files = Array.from(audioInput.files || []);
  if (files.length === 0) {
    uploadStatus.textContent = "Escolha ao menos um arquivo de audio.";
    return;
  }

  saveButton.disabled = true;
  uploadStatus.textContent = "Salvando...";

  try {
    for (const file of files) {
      await uploadAudioFile(file);
    }

    audioInput.value = "";
    uploadStatus.textContent = `${files.length} arquivo(s) salvo(s) com sucesso.`;
    await refreshList();
  } catch (error) {
    console.error(error);
    uploadStatus.textContent = error?.message || "Erro ao salvar os arquivos.";
  } finally {
    saveButton.disabled = false;
  }
}

async function init() {
  try {
    saveButton.addEventListener("click", handleSaveFiles);
    startRandomTimerButton.addEventListener("click", startRandomTimer);
    cancelRandomTimerButton.addEventListener("click", cancelRandomTimer);
    await refreshList();
    timerStateLabel.textContent = "Aguardando";
  } catch (error) {
    console.error(error);
    uploadStatus.textContent = error?.message || "Erro ao conectar com a API.";
    saveButton.disabled = true;
  }
}

init();
