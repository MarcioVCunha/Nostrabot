const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  clearCycleSet,
  drawWeightedRecord,
  loadCycleSet
} = require("../lib/draw");

const memoryStorage = {
  _data: {},
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this._data, key)
      ? this._data[key]
      : null;
  },
  setItem(key, value) {
    this._data[key] = String(value);
  },
  removeItem(key) {
    delete this._data[key];
  }
};

describe("drawWeightedRecord", () => {
  beforeEach(() => {
    memoryStorage._data = {};
  });

  it("respeita ciclo sem repeticao ate esgotar todos", () => {
    clearCycleSet(memoryStorage);
    const records = [
      { url: "a", weight: 1 },
      { url: "b", weight: 1 },
      { url: "c", weight: 1 }
    ];
    const weights = { a: 1, b: 1, c: 1 };
    const seen = new Set();
    for (let i = 0; i < 3; i += 1) {
      const chosen = drawWeightedRecord(records, weights, {
        noRepeatUntilAll: true,
        storage: memoryStorage
      });
      assert.ok(chosen);
      assert.equal(seen.has(chosen.url), false);
      seen.add(chosen.url);
    }
    assert.equal(seen.size, 3);
    assert.equal(loadCycleSet(memoryStorage).size, 3);
    const fourth = drawWeightedRecord(records, weights, {
      noRepeatUntilAll: true,
      storage: memoryStorage
    });
    assert.ok(fourth);
    assert.equal(loadCycleSet(memoryStorage).size, 1);
  });
});
