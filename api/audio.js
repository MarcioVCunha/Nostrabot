const { checkAdminKey } = require("../lib/admin-auth");
const {
  listAudioRecords,
  softDeleteAudio,
  restoreAudio,
  updateAudioMeta,
  upsertAudioRecord
} = require("../lib/audio-index");
const {
  sendJson,
  requireBlobToken,
  friendlyError
} = require("../lib/json-blob");

module.exports = async function handler(req, res) {
  if (!requireBlobToken(res)) return;

  try {
    if (req.method === "GET") {
      const trashed =
        req.query?.trashed === "1" || req.query?.trashed === "true";
      const query = String(req.query?.q || "");

      if (trashed) {
        const auth = checkAdminKey(req.headers);
        if (!auth.ok) {
          return sendJson(res, auth.status, { error: auth.error });
        }
      }

      const items = await listAudioRecords({ trashed, query });
      return sendJson(res, 200, {
        items,
        server_now: new Date().toISOString()
      });
    }

    if (req.method === "POST") {
      // Register / upsert metadata after client upload (idempotent).
      const auth = checkAdminKey(req.headers);
      if (!auth.ok) {
        return sendJson(res, auth.status, { error: auth.error });
      }

      const body =
        typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const action = String(body.action || "register");

      if (action === "restore") {
        const id = String(body.id || "");
        if (!id) return sendJson(res, 400, { error: "id obrigatorio." });
        await restoreAudio(id);
        return sendJson(res, 200, { ok: true });
      }

      if (!body.id || !body.url) {
        return sendJson(res, 400, { error: "id e url obrigatorios." });
      }

      await upsertAudioRecord({
        id: String(body.id),
        name: body.name,
        description: body.description,
        weight: body.weight,
        url: body.url,
        pathname: body.pathname,
        contentType: body.contentType,
        size: body.size,
        uploadedAt: body.uploadedAt || new Date().toISOString(),
        deletedAt: null
      });

      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "PATCH") {
      const auth = checkAdminKey(req.headers);
      if (!auth.ok) {
        return sendJson(res, auth.status, { error: auth.error });
      }

      const body =
        typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const id = String(body.id || "");
      if (!id) return sendJson(res, 400, { error: "id obrigatorio." });

      const updated = await updateAudioMeta(id, {
        name: body.name,
        description: body.description,
        weight: body.weight
      });
      return sendJson(res, 200, { item: updated });
    }

    if (req.method === "DELETE") {
      const auth = checkAdminKey(req.headers);
      if (!auth.ok) {
        return sendJson(res, auth.status, { error: auth.error });
      }

      const id = String(req.query?.id || "");
      if (!id) return sendJson(res, 400, { error: "Parametro id obrigatorio." });

      await softDeleteAudio(id);
      return sendJson(res, 200, { ok: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return sendJson(res, 405, { error: "Metodo nao permitido." });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, {
      error: friendlyError(error, "Não foi possível processar o áudio.")
    });
  }
};
