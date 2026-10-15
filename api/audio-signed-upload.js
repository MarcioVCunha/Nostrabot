const { checkAdminKey } = require("../lib/admin-auth");
const { createAnonClient } = require("../lib/supabase-server");

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Metodo nao permitido." });
  }

  const auth = checkAdminKey(req.headers);
  if (!auth.ok) {
    return sendJson(res, auth.status, { error: auth.error });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const name = String(body.name || "audio").slice(0, 200);
  const description = String(body.description || "").slice(0, 1000);
  const contentType = String(body.contentType || "audio/webm");
  const weight = Number(body.weight) > 0 ? Math.floor(Number(body.weight)) : 1;
  const adminKey = req.headers["x-admin-key"];

  if (!contentType.startsWith("audio/")) {
    return sendJson(res, 400, { error: "Apenas arquivos audio/* sao permitidos." });
  }

  try {
    const supabase = createAnonClient();
    const { data: prepared, error: prepareError } = await supabase.rpc(
      "prepare_audio_upload",
      {
        p_admin_key: adminKey,
        p_name: name,
        p_description: description,
        p_content_type: contentType,
        p_weight: weight
      }
    );

    if (prepareError) {
      const message = prepareError.message || "Falha ao preparar upload.";
      if (/unauthorized|42501/i.test(message)) {
        return sendJson(res, 401, {
          error:
            "Chave de admin invalida no Supabase (hash). Confira NOSTRABOT_ADMIN_KEY e private.app_config."
        });
      }
      if (/could not find|schema cache|PGRST/i.test(message)) {
        return sendJson(res, 503, {
          error:
            "Tabelas do Supabase ainda nao aplicadas. Rode as migrations em supabase/migrations/."
        });
      }
      return sendJson(res, 400, { error: message });
    }

    const storagePath = prepared.storage_path;
    const { data: signed, error: signError } = await supabase.storage
      .from("audios")
      .createSignedUploadUrl(storagePath);

    if (signError) {
      return sendJson(res, 400, {
        error:
          signError.message ||
          "Falha ao gerar URL assinada. Verifique o bucket 'audios' e as policies."
      });
    }

    return sendJson(res, 200, {
      id: prepared.id,
      storagePath,
      contentType,
      signedUrl: signed.signedUrl,
      token: signed.token,
      path: signed.path || storagePath
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, {
      error: error?.message || "Erro interno ao assinar upload."
    });
  }
};
