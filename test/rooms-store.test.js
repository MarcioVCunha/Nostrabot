const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

function installBlobMemory() {
  const store = new Map();
  let etagSeq = 1;

  const api = {
    put: async (pathname, body, options = {}) => {
      const prev = store.get(pathname);
      if (options.ifMatch) {
        if (!prev || prev.etag !== options.ifMatch) {
          const err = new Error("precondition failed");
          err.name = "BlobPreconditionFailedError";
          throw err;
        }
      }
      const etag = `"e${etagSeq++}"`;
      const url = `https://blob.test/${pathname}`;
      store.set(pathname, { body: String(body), etag, url });
      return { url, pathname, etag };
    },
    head: async (pathname) => {
      const row = store.get(pathname);
      if (!row) {
        const err = new Error("not found");
        err.status = 404;
        throw err;
      }
      return { url: row.url, etag: row.etag, pathname };
    },
    BlobNotFoundError: class BlobNotFoundError extends Error {}
  };

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const pathname = String(url).replace(/^https:\/\/blob\.test\//, "").split("?")[0];
    const row = store.get(pathname);
    if (!row) {
      return { status: 404, ok: false, text: async () => "" };
    }
    return {
      status: 200,
      ok: true,
      text: async () => row.body
    };
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "@vercel/blob") return api;
    return originalLoad(request, parent, isMain);
  };

  return {
    store,
    restore() {
      Module._load = originalLoad;
      global.fetch = originalFetch;
      for (const key of Object.keys(require.cache)) {
        if (
          key.includes("/lib/json-blob.js") ||
          key.includes("/lib/rooms-store.js") ||
          key.includes("/lib/audio-index.js") ||
          key.includes("/lib/draw.js") ||
          key.includes("/lib/blob-helpers.js")
        ) {
          delete require.cache[key];
        }
      }
    }
  };
}

describe("rooms-store server-side draw", () => {
  let mem;
  let roomsStore;
  let audioIndex;

  const records = [
    { id: "a1", name: "um", url: "https://x/a1.webm", weight: 1 },
    { id: "a2", name: "dois", url: "https://x/a2.webm", weight: 1 },
    { id: "a3", name: "tres", url: "https://x/a3.webm", weight: 1 }
  ];

  beforeEach(() => {
    mem = installBlobMemory();
    roomsStore = require("../lib/rooms-store");
    audioIndex = require("../lib/audio-index");
    mock.method(audioIndex, "listAudioRecords", async () => records);
  });

  afterEach(() => {
    mock.restoreAll();
    mem.restore();
  });

  it("startRoomTimer grava revision, endsAt, drawnAudioId e next para auto-repeat", async () => {
    const created = await roomsStore.createRoom("Teste");
    const room = await roomsStore.startRoomTimer(created.code, {
      durationMs: 5000,
      autoRepeat: true,
      noRepeatUntilAll: true
    });

    assert.equal(room.state.status, "running");
    assert.equal(room.state.revision, 1);
    assert.ok(room.state.endsAt);
    assert.ok(room.state.drawnAudioId);
    assert.ok(room.state.drawnAudio?.url);
    assert.ok(room.state.nextDrawnAudioId);
    assert.notEqual(room.state.drawnAudioId, room.state.nextDrawnAudioId);
    const endsAt = new Date(room.state.endsAt).getTime();
    assert.ok(endsAt > Date.now());
    assert.ok(endsAt <= Date.now() + 5500);
  });

  it("dois clientes veem o mesmo drawnAudioId e endsAt (sem sorteio local)", async () => {
    const created = await roomsStore.createRoom("Sync");
    const started = await roomsStore.startRoomTimer(created.code, {
      durationMs: 3000,
      autoRepeat: false
    });

    const [clientA, clientB] = await Promise.all([
      roomsStore.getRoom(created.code),
      roomsStore.getRoom(created.code)
    ]);

    assert.equal(clientA.state.drawnAudioId, started.state.drawnAudioId);
    assert.equal(clientB.state.drawnAudioId, started.state.drawnAudioId);
    assert.equal(clientA.state.endsAt, started.state.endsAt);
    assert.equal(clientB.state.endsAt, started.state.endsAt);
    assert.equal(clientA.state.revision, clientB.state.revision);
  });

  it("starts concorrentes nao clobberam — mesmo ciclo / revision", async () => {
    const created = await roomsStore.createRoom("Race");
    const results = await Promise.all([
      roomsStore.startRoomTimer(created.code, { durationMs: 4000, autoRepeat: true }),
      roomsStore.startRoomTimer(created.code, { durationMs: 4000, autoRepeat: true }),
      roomsStore.startRoomTimer(created.code, { durationMs: 4000, autoRepeat: true })
    ]);

    const drawnIds = new Set(results.map((r) => r.state.drawnAudioId));
    const ends = new Set(results.map((r) => r.state.endsAt));
    const revisions = new Set(results.map((r) => r.state.revision));

    assert.equal(drawnIds.size, 1, "todos devem ver o mesmo sorteio");
    assert.equal(ends.size, 1, "todos devem ver o mesmo endsAt");
    assert.equal(revisions.size, 1, "revision unica do ciclo");

    const again = await roomsStore.getRoom(created.code);
    assert.equal(again.state.drawnAudioId, results[0].state.drawnAudioId);
    assert.equal(again.state.endsAt, results[0].state.endsAt);
  });

  it("start tardio com endsAt ainda no futuro nao redesenha", async () => {
    const created = await roomsStore.createRoom("Late");
    const first = await roomsStore.startRoomTimer(created.code, {
      durationMs: 2500,
      autoRepeat: true
    });
    // Simulate a slow second client arriving ~1.7s later (still before endsAt).
    await new Promise((r) => setTimeout(r, 50));
    const second = await roomsStore.startRoomTimer(created.code, {
      durationMs: 2500,
      autoRepeat: true
    });
    assert.equal(second.state.drawnAudioId, first.state.drawnAudioId);
    assert.equal(second.state.endsAt, first.state.endsAt);
    assert.equal(second.state.revision, first.state.revision);
  });

  it("auto-repeat promove nextDrawnAudioId no ciclo seguinte", async () => {
    const created = await roomsStore.createRoom("Repeat");
    const first = await roomsStore.startRoomTimer(created.code, {
      durationMs: 2000,
      autoRepeat: true,
      noRepeatUntilAll: true
    });
    const firstDrawn = first.state.drawnAudioId;
    const firstNext = first.state.nextDrawnAudioId;
    assert.ok(firstNext);

    // Expire the timer so the next start is not treated as sctive no-op.
    await roomsStore.setRoomState(created.code, {
      status: "running",
      endsAt: new Date(Date.now() - 1000).toISOString(),
      drawnAudioId: firstDrawn,
      drawnAudio: first.state.drawnAudio,
      nextDrawnAudioId: firstNext,
      nextDrawnAudio: first.state.nextDrawnAudio,
      autoRepeat: true,
      noRepeatUntilAll: true,
      drawCycleUrls: first.state.drawCycleUrls
    });

    const second = await roomsStore.startRoomTimer(created.code, {
      durationMs: 2000,
      autoRepeat: true,
      noRepeatUntilAll: true
    });

    assert.equal(second.state.drawnAudioId, firstNext);
    assert.ok(second.state.nextDrawnAudioId);
    assert.notEqual(second.state.drawnAudioId, firstDrawn);
    assert.ok(second.state.revision > first.state.revision);
  });
});

describe("two simulated clients polling room state", () => {
  let mem;
  let roomsStore;
  let audioIndex;

  beforeEach(() => {
    mem = installBlobMemory();
    roomsStore = require("../lib/rooms-store");
    audioIndex = require("../lib/audio-index");
    mock.method(audioIndex, "listAudioRecords", async () => [
      { id: "x1", name: "alpha", url: "https://x/x1.webm", weight: 5 },
      { id: "x2", name: "beta", url: "https://x/x2.webm", weight: 5 }
    ]);
  });

  afterEach(() => {
    mock.restoreAll();
    mem.restore();
  });

  it("varios ciclos: ambos clientes sempre alinhados", async () => {
    const created = await roomsStore.createRoom("Cycles");
    const snapshots = [];

    for (let cycle = 0; cycle < 3; cycle += 1) {
      if (cycle > 0) {
        const cur = await roomsStore.getRoom(created.code);
        await roomsStore.setRoomState(created.code, {
          ...cur.state,
          status: "running",
          endsAt: new Date(Date.now() - 50).toISOString()
        });
      }
      await roomsStore.startRoomTimer(created.code, {
        durationMs: 1500,
        autoRepeat: true
      });

      const [a, b] = await Promise.all([
        roomsStore.getRoom(created.code),
        roomsStore.getRoom(created.code)
      ]);
      assert.equal(a.state.drawnAudioId, b.state.drawnAudioId);
      assert.equal(a.state.endsAt, b.state.endsAt);
      assert.equal(a.state.revision, b.state.revision);
      snapshots.push({
        drawnAudioId: a.state.drawnAudioId,
        endsAt: a.state.endsAt,
        revision: a.state.revision
      });
    }

    assert.equal(snapshots.length, 3);
    assert.ok(snapshots[1].revision > snapshots[0].revision);
    assert.ok(snapshots[2].revision > snapshots[1].revision);
  });
});
