const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_UPLOAD_BYTES,
  getSafeFileName,
  isAllowedBlobUrl,
  isAudioContentType,
  buildAudioPathname
} = require("../lib/blob-helpers");

describe("blob-helpers", () => {
  it("limita upload a 25 MB", () => {
    assert.equal(MAX_UPLOAD_BYTES, 25 * 1024 * 1024);
  });

  it("sanitiza nomes de arquivo", () => {
    assert.equal(getSafeFileName("meu audio#.mp3"), "meu_audio_.mp3");
    assert.equal(getSafeFileName(""), "audio");
  });

  it("valida URLs de blob sob /audios/", () => {
    assert.equal(
      isAllowedBlobUrl("https://example.public.blob.vercel-storage.com/audios/a.mp3"),
      true
    );
    assert.equal(
      isAllowedBlobUrl("https://example.public.blob.vercel-storage.com/other/a.mp3"),
      false
    );
    assert.equal(isAllowedBlobUrl("not-a-url"), false);
    assert.equal(isAllowedBlobUrl(""), false);
  });

  it("aceita apenas content-types audio/*", () => {
    assert.equal(isAudioContentType("audio/mpeg"), true);
    assert.equal(isAudioContentType("audio/wav"), true);
    assert.equal(isAudioContentType("image/png"), false);
    assert.equal(isAudioContentType(""), false);
  });

  it("monta pathname com prefixo audios/", () => {
    assert.equal(
      buildAudioPathname("voz.mp3", 1700000000000),
      "audios/1700000000000-voz.mp3"
    );
  });
});
