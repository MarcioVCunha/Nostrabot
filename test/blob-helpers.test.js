const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_UPLOAD_BYTES,
  getSafeFileName,
  isAudioContentType,
  buildAudioPathname,
  isWithinTrashWindow,
  TRASH_RETENTION_MS
} = require("../lib/blob-helpers");

describe("blob-helpers", () => {
  it("limita upload a 25 MB", () => {
    assert.equal(MAX_UPLOAD_BYTES, 25 * 1024 * 1024);
  });

  it("sanitiza nomes de arquivo", () => {
    assert.equal(getSafeFileName("meu audio#.mp3"), "meu_audio_.mp3");
    assert.equal(getSafeFileName(""), "audio");
  });

  it("aceita apenas content-types audio/*", () => {
    assert.equal(isAudioContentType("audio/mpeg"), true);
    assert.equal(isAudioContentType("audio/wav"), true);
    assert.equal(isAudioContentType("image/png"), false);
    assert.equal(isAudioContentType(""), false);
  });

  it("monta pathname audios/<id>.<ext>", () => {
    assert.equal(
      buildAudioPathname("abc", "audio/webm", "voz.webm"),
      "audios/abc.webm"
    );
    assert.equal(
      buildAudioPathname("abc", "audio/mpeg", "voz.mp3"),
      "audios/abc.mp3"
    );
  });

  it("respeita janela de 30 dias na lixeira", () => {
    const now = Date.now();
    assert.equal(
      isWithinTrashWindow(new Date(now - TRASH_RETENTION_MS + 1000).toISOString(), now),
      true
    );
    assert.equal(
      isWithinTrashWindow(new Date(now - TRASH_RETENTION_MS - 1000).toISOString(), now),
      false
    );
    assert.equal(isWithinTrashWindow(null, now), false);
  });
});
