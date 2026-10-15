const SESSION_KEY = "nostrabotPrankAdHidden";

export function initPrankAd() {
  const root = document.getElementById("prankAd");
  const closeButton = document.getElementById("prankAdClose");
  if (!root) return;

  try {
    if (sessionStorage.getItem(SESSION_KEY) === "1") {
      root.hidden = true;
      return;
    }
  } catch (error) {
    // ignore
  }

  root.hidden = false;

  if (closeButton) {
    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      root.hidden = true;
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch (error) {
        // ignore
      }
    });
  }
}
