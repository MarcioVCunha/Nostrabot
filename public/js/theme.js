export function getPreferredTheme() {
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  const prefersDark =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

export function applyTheme(theme, themeToggle) {
  document.body.setAttribute("data-theme", theme);
  if (!themeToggle) return;
  themeToggle.textContent = theme === "dark" ? "Tema: Escuro" : "Tema: Claro";
}

export function initThemeToggle(themeToggle) {
  if (!themeToggle) return;

  applyTheme(getPreferredTheme(), themeToggle);
  themeToggle.addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    applyTheme(next, themeToggle);
  });
}
