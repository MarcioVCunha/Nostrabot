const { handleUpload } = require("@vercel/blob/client");
const { checkAdminKey } = require("../lib/admin-auth");
const { MAX_UPLOAD_BYTES, isAudioContentType } = require("../lib/blob-helpers");

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Metodo nao permitido." });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return sendJson(res, 500, {
      error:
        "BLOB_READ_WRITE_TOKEN nao configurado no projeto Vercel. Crie um Blob store em 'Storage/Blob' e redeploy."
    });
  }

  const auth = checkAdminKey(req.headers);
  if (!auth.ok) {
    return sendJson(res, auth.status, { error: auth.error });
  }

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname || !String(pathname).startsWith("audios/")) {
          throw new Error(
            "Caminho de upload invalido. Use o prefixo audios/."
          );
        }

        return {
          allowedContentTypes: ["audio/*"],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true
        };
      },
      onUploadCompleted: async ({ blob }) => {
        if (blob?.contentType && !isAudioContentType(blob.contentType)) {
          console.warn(
            "Upload concluido com content-type inesperado:",
            blob.contentType
          );
        }
      }
    });

    return sendJson(res, 200, jsonResponse);
  } catch (error) {
    console.error(error);
    const message =
      error?.message || "Falha ao autorizar o upload do audio.";
    return sendJson(res, 400, { error: message });
  }
};
