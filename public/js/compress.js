/**
 * Recomprime áudio no cliente para um formato compacto.
 * Se falhar, devolve o arquivo original.
 */
export async function compressAudioFile(file, onProgress) {
  if (!file) throw new Error("Arquivo ausente.");

  if (typeof onProgress === "function") onProgress(0.05);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioCtx = new AudioContext();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    if (typeof onProgress === "function") onProgress(0.35);

    const offline = new OfflineAudioContext(
      1,
      decoded.duration * 24000,
      24000
    );
    const source = offline.createBufferSource();
    // Mixdown to mono
    const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate);
    const channel = mono.getChannelData(0);
    const channels = decoded.numberOfChannels;
    for (let i = 0; i < decoded.length; i += 1) {
      let sum = 0;
      for (let c = 0; c < channels; c += 1) {
        sum += decoded.getChannelData(c)[i];
      }
      channel[i] = sum / channels;
    }
    source.buffer = mono;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    if (typeof onProgress === "function") onProgress(0.6);

    const blob = await encodeWithMediaRecorder(rendered, audioCtx.sampleRate);
    await audioCtx.close().catch(() => {});
    if (typeof onProgress === "function") onProgress(1);

    const base = (file.name || "audio").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.webm`, {
      type: blob.type || "audio/webm",
      lastModified: Date.now()
    });
  } catch (error) {
    console.warn("Compressão falhou, enviando original:", error);
    if (typeof onProgress === "function") onProgress(1);
    return file;
  }
}

function encodeWithMediaRecorder(audioBuffer) {
  return new Promise((resolve, reject) => {
    const ctx = new AudioContext({ sampleRate: audioBuffer.sampleRate });
    const dest = ctx.createMediaStreamDestination();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(dest);

    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const recorder = new MediaRecorder(dest.stream, {
      mimeType: mime,
      audioBitsPerSecond: 64_000
    });
    const chunks = [];

    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error("MediaRecorder falhou"));
    recorder.onstop = async () => {
      await ctx.close().catch(() => {});
      resolve(new Blob(chunks, { type: mime }));
    };

    recorder.start();
    source.onended = () => {
      setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 50);
    };
    source.start(0);
  });
}
