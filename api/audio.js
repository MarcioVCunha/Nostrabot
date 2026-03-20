const { put, list, del } = require("@vercel/blob");

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

function getSafeFileName(name) {
  return (name || "audio")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/_+/g, "_");
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

    if (req.method === "POST") {
      const encodedName = req.headers["x-file-name"];
      const originalName = encodedName
        ? decodeURIComponent(encodedName)
        : "audio";
      const contentType = req.headers["x-content-type"] || "audio/mpeg";
      const safeName = getSafeFileName(originalName);
      const pathname = `audios/${Date.now()}-${safeName}`;

      const blob = await put(pathname, req, {
        access: "public",
        contentType,
        addRandomSuffix: true
      });

      return sendJson(res, 201, { item: blob });
    }

    if (req.method === "DELETE") {
      const { url } = req.query;
      if (!url) {
        return sendJson(res, 400, { error: "Parametro 'url' obrigatorio." });
      }

      await del(url);
      return sendJson(res, 200, { ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return sendJson(res, 405, { error: "Metodo nao permitido." });
  } catch (error) {
    console.error(error);

    const message = error?.message || "Erro interno na API de audio.";
    let friendlyMessage = message;

    if (/This store does not exist/i.test(message)) {
      friendlyMessage =
        "Vercel Blob: a Blob store referenciada nao existe (token desatualizado ou store recriada). Recrie a Blob store em 'Storage/Blob' e faça redeploy (incluindo Preview/Production).";
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
