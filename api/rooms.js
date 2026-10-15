const {
  createRoom,
  getRoom,
  setRoomState,
  startRoomTimer
} = require("../lib/rooms-store");
const { sendJson, requireBlobToken } = require("../lib/json-blob");

module.exports = async function handler(req, res) {
  if (!requireBlobToken(res)) return;

  try {
    if (req.method === "GET") {
      const code = String(req.query?.code || "").trim();
      if (!code) {
        return sendJson(res, 200, {
          server_now: new Date().toISOString()
        });
      }
      const room = await getRoom(code);
      if (!room) {
        return sendJson(res, 404, { error: "Sala nao encontrada." });
      }
      return sendJson(res, 200, { room });
    }

    if (req.method === "POST") {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const action = String(body.action || "create");

      if (action === "create") {
        const room = await createRoom(body.name || "Sala Nostrabot");
        return sendJson(res, 201, { room });
      }

      if (action === "start") {
        const code = String(body.code || "");
        if (!code) return sendJson(res, 400, { error: "code obrigatorio." });
        const room = await startRoomTimer(code, body.durationMs);
        return sendJson(res, 200, { room });
      }

      if (action === "state") {
        const code = String(body.code || "");
        if (!code) return sendJson(res, 400, { error: "code obrigatorio." });
        const room = await setRoomState(code, body.state || {});
        return sendJson(res, 200, { room });
      }

      return sendJson(res, 400, { error: "action invalida." });
    }

    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Metodo nao permitido." });
  } catch (error) {
    console.error(error);
    const status = /nao encontrada/i.test(String(error?.message || ""))
      ? 404
      : 500;
    return sendJson(res, status, {
      error: error?.message || "Erro interno nas salas."
    });
  }
};
