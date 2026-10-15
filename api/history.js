const { listPlayHistory, recordPlayEvent } = require("../lib/history-store");
const { sendJson, requireBlobToken } = require("../lib/json-blob");

module.exports = async function handler(req, res) {
  if (!requireBlobToken(res)) return;

  try {
    if (req.method === "GET") {
      const roomId = req.query?.roomId || null;
      const limit = Number(req.query?.limit) || 30;
      const events = await listPlayHistory({ roomId, limit });
      return sendJson(res, 200, {
        events,
        server_now: new Date().toISOString()
      });
    }

    if (req.method === "POST") {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const event = await recordPlayEvent({
        audioId: body.audioId,
        audioName: body.audioName,
        audioUrl: body.audioUrl,
        roomId: body.roomId
      });
      return sendJson(res, 201, { event });
    }

    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Metodo nao permitido." });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, {
      error: error?.message || "Erro interno no historico."
    });
  }
};
