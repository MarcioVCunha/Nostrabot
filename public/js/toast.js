let host;

function ensureHost() {
  if (host) return host;
  host = document.createElement("div");
  host.className = "toast-host";
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}

export function showToast(message, options = {}) {
  const { actionLabel, onAction, timeoutMs = 6000 } = options;
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;

  if (actionLabel && typeof onAction === "function") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => {
      onAction();
      el.remove();
    });
    el.appendChild(btn);
  }

  ensureHost().appendChild(el);
  window.setTimeout(() => el.remove(), timeoutMs);
  return el;
}
