const { list, del } = require("@vercel/blob");
const { checkAdminKey } = require("../lib/admin-auth");
const { isAllowedBlobUrl } = require("../lib/blob-helpers");

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

module.exports = async function handler(req, res) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return sendJson(res, 500, {
        error:
          "BLOB_READ_WRITE_TOKEN nao configurado no projeto Vercel. Crie um Blob store em 'Storage/Blob' e redeploy."
      });
    }

    if (req.method === "GET") {
      const { blobs } = await list({ prefix: "audios/" });
      return sendJson(res, 200, { items: blobs });
    }

    if (req.method === "DELETE") {
      const auth = checkAdminKey(req.headers);
      if (!auth.ok) {
        return sendJson(res, auth.status, { error: auth.error });
      }

      const { url } = req.query;
      if (!url) {
        return sendJson(res, 400, { error: "Parametro 'url' obrigatorio." });
      }

      if (!isAllowedBlobUrl(url)) {
        return sendJson(res, 400, {
          error: "URL de audio invalida para exclusao."
        });
      }

      await del(url);
      return sendJson(res, 200, { ok: true });
    }

    res.setHeader("Allow", "GET, DELETE");
    return sendJson(res, 405, {
      error:
        "Metodo nao permitido. Use POST /api/upload para enviar audios (upload direto)."
    });
  } catch (error) {
    console.error(error);

    const message = error?.message || "Erro interno na API de audio.";
    let friendlyMessage = message;

    if (/This store does not exist/i.test(message)) {
      friendlyMessage =
        "Vercel Blob: a Blob store referenciada nao existe (token desatualizado ou store recriada). Recrie a Blob store em 'Storage/Blob' e faca redeploy (incluindo Preview/Production).";
    }

    if (/Cannot use public access on a private store/i.test(message)) {
      friendlyMessage =
        "Vercel Blob: voce esta usando 'access: public' mas a Blob store esta configurada como private. Ajuste a store para Public (ou mude o codigo para signed URLs).";
    }

    return sendJson(res, 500, {
      error: friendlyMessage
    });
  }
};
