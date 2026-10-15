const ADMIN_HEADER = "x-admin-key";

/**
 * Checks whether a write request is authorized with NOSTRABOT_ADMIN_KEY.
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
function checkAdminKey(headers, env = process.env) {
  const configured = env.NOSTRABOT_ADMIN_KEY;

  if (!configured || typeof configured !== "string" || !configured.trim()) {
    return {
      ok: false,
      status: 503,
      error:
        "Escrita desabilitada: NOSTRABOT_ADMIN_KEY nao configurada no servidor."
    };
  }

  const raw = headers?.[ADMIN_HEADER] ?? headers?.[ADMIN_HEADER.toLowerCase()];
  const provided = Array.isArray(raw) ? raw[0] : raw;

  if (!provided || typeof provided !== "string") {
    return {
      ok: false,
      status: 401,
      error: "Chave de admin ausente. Informe a chave no cabecalho x-admin-key."
    };
  }

  if (provided !== configured) {
    return {
      ok: false,
      status: 401,
      error: "Chave de admin invalida."
    };
  }

  return { ok: true };
}

module.exports = {
  ADMIN_HEADER,
  checkAdminKey
};
