export function getPreferredTheme() {
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  // Phase 5 default: mystical dark
  return "dark";
}

export function applyTheme(theme, themeToggle) {
  document.body.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#090612" : "#f3f0ea";
  if (!themeToggle) return;
  themeToggle.textContent = theme === "dark" ? "Tema: Místico" : "Tema: Claro";
}

export function initThemeToggle(themeToggle) {
  if (!themeToggle) return;

  applyTheme(getPreferredTheme(), themeToggle);
  themeToggle.addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    applyTheme(next, themeToggle);
  });
}
