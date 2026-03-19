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
    return sendJson(res, 500, { error: "Erro interno na API de audio." });
  }
};
