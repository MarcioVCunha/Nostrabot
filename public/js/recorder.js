export function createMicRecorder({ onStop, onError } = {}) {
  let mediaRecorder = null;
  let stream = null;
  let chunks = [];

  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    chunks = [];
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: mime,
      audioBitsPerSecond: 96_000
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    mediaRecorder.onerror = (event) => {
      if (typeof onError === "function") onError(event.error || event);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      const file = new File([blob], `gravacao-${Date.now()}.webm`, {
        type: blob.type,
        lastModified: Date.now()
      });
      stopTracks();
      if (typeof onStop === "function") onStop(file);
    };

    mediaRecorder.start();
  }

  function stop() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    } else {
      stopTracks();
    }
  }

  function stopTracks() {
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  function isRecording() {
    return mediaRecorder?.state === "recording";
  }

  return { start, stop, isRecording };
}
