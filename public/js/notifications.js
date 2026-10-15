export async function ensureNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function notifyTimerEnded(title, body) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      return;
    }
    const notification = new Notification(title || "Nostrabot", {
      body: body || "O timer terminou.",
      tag: "nostrabot-timer",
      renotify: true
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch (error) {
    console.warn("Notification falhou:", error);
  }
}
