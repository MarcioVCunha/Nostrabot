const { put, head } = require("@vercel/blob");
const { checkAdminKey } = require("../lib/admin-auth");
const {
  findBySourceId,
  upsertAudioRecord,
  cleanupOrphanAudios,
  readAudioIndex
} = require("../lib/audio-index");
const {
  buildAudioPathname,
  extensionFromContentType,
  newId
} = require("../lib/blob-helpers");
const { sendJson, requireBlobToken, isNotFound } = require("../lib/json-blob");

async function blobExists(pathnameOrUrl) {
  if (!pathnameOrUrl) return false;
  try {
    await head(pathnameOrUrl);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    // Fallback: public GET
    try {
      const res = await fetch(pathnameOrUrl, { method: "HEAD" });
      if (res.ok) return true;
      if (res.status === 404) return false;
    } catch (inner) {
      // ignore
    }
    return false;
  }
}

const SUPABASE_URL = "https://slkztbeihpesepamjcbo.supabase.co";
const SUPABASE_ANON_KEY =
  "sb_publishable_bB3svjN36RwUrz-4RHBP3Q_P8XzyaDs";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Metodo nao permitido." });
  }

  const auth = checkAdminKey(req.headers);
  if (!auth.ok) {
    return sendJson(res, auth.status, { error: auth.error });
  }

  if (!requireBlobToken(res)) return;

  const results = [];
  const writtenPathnames = new Set();

  try {
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/audios?select=*&order=created_at.asc`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );

    if (!listRes.ok) {
      const text = await listRes.text();
      return sendJson(res, 502, {
        error: `Falha ao listar audios no Supabase (${listRes.status}): ${text.slice(0, 200)}`
      });
    }

    const rows = await listRes.json();
    if (!Array.isArray(rows)) {
      return sendJson(res, 502, { error: "Resposta inesperada do Supabase." });
    }

    for (const row of rows) {
      const sourceId = String(row.id || "");
      const entry = {
        sourceId,
        name: row.name,
        status: "pending"
      };

      try {
        const existing = await findBySourceId(sourceId);
        if (existing) {
          const alive = await blobExists(existing.pathname || existing.url);
          if (alive) {
            if (existing.pathname) writtenPathnames.add(existing.pathname);
            entry.status = "skipped";
            entry.id = existing.id;
            entry.url = existing.url;
            entry.pathname = existing.pathname;
            results.push(entry);
            continue;
          }
          entry.repaired = true;
        }

        const storagePath = String(row.storage_path || "");
        if (!storagePath) {
          entry.status = "error";
          entry.error = "storage_path ausente";
          results.push(entry);
          continue;
        }

        const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/audios/${storagePath}`;
        const fileRes = await fetch(publicUrl);
        if (!fileRes.ok) {
          throw new Error(`Download falhou (${fileRes.status})`);
        }

        const contentType =
          fileRes.headers.get("content-type") ||
          row.content_type ||
          "audio/webm";
        const buffer = Buffer.from(await fileRes.arrayBuffer());
        const id = existing?.id || newId();
        const pathname = buildAudioPathname(
          id,
          contentType,
          storagePath || row.name
        );

        const blob = await put(pathname, buffer, {
          access: "public",
          contentType,
          addRandomSuffix: false,
          allowOverwrite: true
        });

        writtenPathnames.add(blob.pathname || pathname);

        await upsertAudioRecord({
          id,
          name: row.name || "audio",
          description: row.description || "",
          weight: row.weight ?? 1,
          url: blob.url,
          pathname: blob.pathname,
          contentType,
          size: row.size_bytes || buffer.length,
          uploadedAt: row.created_at || existing?.uploadedAt || new Date().toISOString(),
          deletedAt: row.deleted_at || null,
          sourceId
        });

        entry.status = entry.repaired ? "repaired" : "migrated";
        entry.id = id;
        entry.url = blob.url;
        entry.pathname = blob.pathname;
        entry.ext = extensionFromContentType(contentType, storagePath);
      } catch (error) {
        entry.status = "error";
        entry.error = error?.message || String(error);
      }

      results.push(entry);
    }

    // Protect every pathname we know about before orphan sweep.
    const indexAfter = await readAudioIndex();
    for (const item of indexAfter.items || []) {
      if (item.pathname) writtenPathnames.add(item.pathname);
    }

    let orphans = null;
    try {
      orphans = await cleanupOrphanAudios({
        protectPathnames: writtenPathnames
      });
    } catch (error) {
      orphans = {
        error: error?.message || String(error)
      };
    }

    const finalIndex = await readAudioIndex();

    return sendJson(res, 200, {
      total: rows.length,
      migrated: results.filter((r) => r.status === "migrated").length,
      repaired: results.filter((r) => r.status === "repaired").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      errors: results.filter((r) => r.status === "error").length,
      indexCount: (finalIndex.items || []).filter((i) => !i.deletedAt).length,
      results,
      orphans
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, {
      error: error?.message || "Erro na migracao do Supabase."
    });
  }
};
