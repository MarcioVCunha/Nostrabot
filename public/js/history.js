export async function recordPlayEvent({ audioId, audioName, audioUrl }) {
  try {
    const response = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioId, audioName, audioUrl })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.warn("Falha ao gravar histórico:", data.error || response.status);
    }
  } catch (error) {
    console.warn("Falha ao gravar histórico:", error);
  }
}

export async function listPlayHistory({ limit = 30 } = {}) {
  try {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    const response = await fetch(`/api/history?${params}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.events || [];
  } catch (error) {
    console.warn(error);
    return [];
  }
}
