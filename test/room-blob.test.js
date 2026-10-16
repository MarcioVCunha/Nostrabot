const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  revisionFromRoomPathname,
  compareRoomVersionBlobs
} = require("../lib/room-blob");

describe("room-blob version ordering", () => {
  it("extrai revision do pathname versionado", () => {
    assert.equal(
      revisionFromRoomPathname("rooms/ABCD/r12-token.json"),
      12
    );
    assert.equal(revisionFromRoomPathname("rooms/ABCD.json"), -1);
    assert.equal(revisionFromRoomPathname(""), -1);
  });

  it("ordena por revision decrescente (nao so uploadedAt)", () => {
    const blobs = [
      {
        pathname: "rooms/X/r1-a.json",
        uploadedAt: "2026-10-15T19:00:02.000Z"
      },
      {
        pathname: "rooms/X/r3-c.json",
        uploadedAt: "2026-10-15T19:00:00.000Z"
      },
      {
        pathname: "rooms/X/r2-b.json",
        uploadedAt: "2026-10-15T19:00:01.000Z"
      }
    ];
    const sorted = [...blobs].sort(compareRoomVersionBlobs);
    assert.equal(sorted[0].pathname, "rooms/X/r3-c.json");
    assert.equal(sorted[1].pathname, "rooms/X/r2-b.json");
    assert.equal(sorted[2].pathname, "rooms/X/r1-a.json");
  });

  it("desempata revision igual por uploadedAt mais recente", () => {
    const blobs = [
      {
        pathname: "rooms/X/r2-old.json",
        uploadedAt: "2026-10-15T19:00:00.000Z"
      },
      {
        pathname: "rooms/X/r2-new.json",
        uploadedAt: "2026-10-15T19:00:05.000Z"
      }
    ];
    const sorted = [...blobs].sort(compareRoomVersionBlobs);
    assert.equal(sorted[0].pathname, "rooms/X/r2-new.json");
  });
});
