const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeAudioIndex,
  findOrphanAudioBlobs,
  toPublicAudioRecord,
  emptyIndex
} = require("../lib/audio-index");
const { isNotFound } = require("../lib/json-blob");

describe("normalizeAudioIndex (readJsonBlob unwrap)", () => {
  it("reproduz o bug antigo: tratar {data,etag} como index deixa items vazio", () => {
    const wrapped = {
      data: {
        version: 1,
        items: [{ id: "a1", name: "Deram 20 minutos", pathname: "audios/a1.webm" }]
      },
      etag: '"abc"'
    };

    // Bug antigo: data.items onde data era o wrapper → undefined → empty
    const buggy =
      !wrapped || !Array.isArray(wrapped.items) ? emptyIndex() : wrapped;
    assert.equal(buggy.items.length, 0);

    // Correção: unwrap .data
    const fixed = normalizeAudioIndex(wrapped);
    assert.equal(fixed.items.length, 1);
    assert.equal(fixed.items[0].name, "Deram 20 minutos");
  });

  it("aceita index bare (sem wrapper)", () => {
    const bare = {
      version: 1,
      items: [{ id: "x", name: "ok" }]
    };
    assert.equal(normalizeAudioIndex(bare).items.length, 1);
  });

  it("volta fallback quando data.items nao e array", () => {
    assert.deepEqual(
      normalizeAudioIndex({ data: { version: 1 }, etag: null }),
      emptyIndex()
    );
  });
});

describe("toPublicAudioRecord", () => {
  it("remove sourceId da metadata publica", () => {
    const publicItem = toPublicAudioRecord({
      id: "1",
      name: "x",
      sourceId: "legacy-supabase-id"
    });
    assert.equal(publicItem.id, "1");
    assert.equal(publicItem.sourceId, undefined);
    assert.equal("sourceId" in publicItem, false);
  });
});

describe("findOrphanAudioBlobs", () => {
  it("marca blobs sob audios/ nao referenciados pelo index", () => {
    const indexItems = [
      { id: "1", pathname: "audios/keep.webm", url: "https://x/audios/keep.webm" }
    ];
    const blobs = [
      { pathname: "audios/keep.webm", url: "https://x/audios/keep.webm" },
      { pathname: "audios/orphan.webm", url: "https://x/audios/orphan.webm" },
      { pathname: "data/audios-index.json", url: "https://x/data/audios-index.json" }
    ];
    const orphans = findOrphanAudioBlobs(indexItems, blobs);
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].pathname, "audios/orphan.webm");
  });
});

describe("isNotFound", () => {
  it("reconhece BlobNotFound e mensagens 404", () => {
    assert.equal(isNotFound({ message: "The requested blob was not found" }), true);
    assert.equal(isNotFound({ status: 404 }), true);
    assert.equal(isNotFound({ message: "403 Forbidden", status: 403 }), false);
  });
});
