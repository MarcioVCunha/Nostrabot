const { list } = require("@vercel/blob");
const { checkAdminKey } = require("../lib/admin-auth");
const { createAnonClient, SUPABASE_URL } = require("../lib/supabase-server");

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

function displayNameFromPath(pathname) {
  const raw = (pathname || "").split("/").pop() || "audio";
  return decodeURIComponent(raw.replace(/^\d+-/, "").replace(/\.[^.]+$/, ""));
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

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return sendJson(res, 500, {
      error: "BLOB_READ_WRITE_TOKEN nao configurado."
    });
  }

  const adminKey = req.headers["x-admin-key"];
  const supabase = createAnonClient();
  const results = [];

  try {
    const { blobs } = await list({ prefix: "audios/" });

    for (const blob of blobs) {
      const entry = {
        blobUrl: blob.url,
        pathname: blob.pathname,
        status: "pending"
      };

      try {
        const { data: existing } = await supabase
          .from("audios")
          .select("id")
          .eq("blob_url", blob.url)
          .maybeSingle();

        if (existing?.id) {
          entry.status = "skipped";
          entry.id = existing.id;
          results.push(entry);
          continue;
        }

        const fileRes = await fetch(blob.url);
        if (!fileRes.ok) {
          throw new Error(`Download blob falhou (${fileRes.status})`);
        }
        const buffer = Buffer.from(await fileRes.arrayBuffer());
        const contentType =
          fileRes.headers.get("content-type") || blob.contentType || "audio/mpeg";
        const name = displayNameFromPath(blob.pathname);
        const safeType = contentType.startsWith("audio/")
          ? contentType
          : "audio/mpeg";

        const { data: prepared, error: prepareError } = await supabase.rpc(
          "prepare_audio_upload",
          {
            p_admin_key: adminKey,
            p_name: name,
            p_description: `Migrado de Vercel Blob (${blob.pathname})`,
            p_content_type: safeType,
            p_weight: 1
          }
        );
        if (prepareError) throw prepareError;

        const { data: signed, error: signError } = await supabase.storage
          .from("audios")
          .createSignedUploadUrl(prepared.storage_path);
        if (signError) throw signError;

        const { error: uploadError } = await supabase.storage
          .from("audios")
          .uploadToSignedUrl(prepared.storage_path, signed.token, buffer, {
            contentType: safeType,
            upsert: false
          });
        if (uploadError) throw uploadError;

        const { error: finalizeError } = await supabase.rpc(
          "finalize_audio_upload",
          {
            p_admin_key: adminKey,
            p_id: prepared.id,
            p_size_bytes: buffer.length
          }
        );
        if (finalizeError) throw finalizeError;

        await supabase.rpc("set_audio_blob_url", {
          p_admin_key: adminKey,
          p_id: prepared.id,
          p_blob_url: blob.url
        });

        entry.status = "migrated";
        entry.id = prepared.id;
        entry.publicUrl = `${SUPABASE_URL}/storage/v1/object/public/audios/${prepared.storage_path}`;
      } catch (error) {
        entry.status = "error";
        entry.error = error?.message || String(error);
      }

      results.push(entry);
    }

    return sendJson(res, 200, {
      total: blobs.length,
      migrated: results.filter((r) => r.status === "migrated").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      errors: results.filter((r) => r.status === "error").length,
      results
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, {
      error: error?.message || "Falha na migracao Blob -> Supabase."
    });
  }
};
