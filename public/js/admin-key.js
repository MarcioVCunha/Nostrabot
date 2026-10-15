const ADMIN_KEY_STORAGE = "nostrabotAdminKey";

export function getStoredAdminKey() {
  try {
    return localStorage.getItem(ADMIN_KEY_STORAGE) || "";
  } catch (error) {
    console.error("Erro ao ler chave de admin:", error);
    return "";
  }
}

export function setStoredAdminKey(key) {
  localStorage.setItem(ADMIN_KEY_STORAGE, key || "");
}

export function clearStoredAdminKey() {
  localStorage.removeItem(ADMIN_KEY_STORAGE);
}

/**
 * Garante que existe uma chave de admin no localStorage.
 * Pede ao usuario se ainda nao houver (ou se forcePrompt).
 * @param {{ forcePrompt?: boolean }} [options]
 * @returns {string | null}
 */
export function ensureAdminKey(options = {}) {
  const { forcePrompt = false } = options;
  const current = getStoredAdminKey();

  if (!forcePrompt && current) return current;

  const message = forcePrompt
    ? "Informe a nova chave de admin do Nostrabot:"
    : "Informe a chave de admin para enviar ou excluir áudios:";

  const value = window.prompt(message, current || "");
  if (value == null) return null;

  const trimmed = value.trim();
  if (!trimmed) {
    clearStoredAdminKey();
    return null;
  }

  setStoredAdminKey(trimmed);
  return trimmed;
}

export function adminHeaders() {
  const key = getStoredAdminKey();
  if (!key) return {};
  return { "x-admin-key": key };
}
