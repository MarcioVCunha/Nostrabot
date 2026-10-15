const { handleUpload } = require("@vercel/blob/client");
const { checkAdminKey } = require("../lib/admin-auth");
const { upsertAudioRecord } = require("../lib/audio-index");
const {
  MAX_UPLOAD_BYTES,
  isAudioContentType
} = require("../lib/blob-helpers");
const { sendJson, requireBlobToken } = require("../lib/json-blob");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Metodo nao permitido." });
  }

  if (!requireBlobToken(res)) return;

  const auth = checkAdminKey(req.headers);
  if (!auth.ok) {
    return sendJson(res, auth.status, { error: auth.error });
  }

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!pathname || !String(pathname).startsWith("audios/")) {
          throw new Error("Caminho de upload invalido. Use o prefixo audios/.");
        }

        let meta = {};
        try {
          meta = clientPayload ? JSON.parse(clientPayload) : {};
        } catch (error) {
          meta = {};
        }

        return {
          allowedContentTypes: ["audio/*"],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: JSON.stringify({
            id: meta.id || null,
            name: meta.name || "audio",
            description: meta.description || "",
            weight: meta.weight || 1
          })
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        if (blob?.contentType && !isAudioContentType(blob.contentType)) {
          console.warn(
            "Upload concluido com content-type inesperado:",
            blob.contentType
          );
        }

        let meta = {};
        try {
          meta = tokenPayload ? JSON.parse(tokenPayload) : {};
        } catch (error) {
          meta = {};
        }

        if (!meta.id) return;

        try {
          await upsertAudioRecord({
            id: meta.id,
            name: meta.name,
            description: meta.description,
            weight: meta.weight,
            url: blob.url,
            pathname: blob.pathname,
            contentType: blob.contentType,
            size: blob.size || 0,
            uploadedAt: new Date().toISOString(),
            deletedAt: null
          });
        } catch (error) {
          console.error("Falha ao registrar metadata apos upload:", error);
        }
      }
    });

    return sendJson(res, 200, jsonResponse);
  } catch (error) {
    console.error(error);
    return sendJson(res, 400, {
      error: error?.message || "Falha ao autorizar o upload do audio."
    });
  }
};
