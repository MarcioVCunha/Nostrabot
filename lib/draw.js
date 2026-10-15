const CYCLE_KEY = "nostrabotDrawCycle";

function getStorage(storage) {
  return storage || globalThis.localStorage;
}

function loadCycleSet(storage) {
  try {
    const raw = getStorage(storage).getItem(CYCLE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (error) {
    return new Set();
  }
}

function saveCycleSet(set, storage) {
  getStorage(storage).setItem(CYCLE_KEY, JSON.stringify([...set]));
}

function clearCycleSet(storage) {
  getStorage(storage).removeItem(CYCLE_KEY);
}

function drawWeightedRecord(
  records,
  weights,
  { noRepeatUntilAll = false, storage } = {}
) {
  if (!records?.length) return null;

  let pool = records;
  let cycle = loadCycleSet(storage);

  if (noRepeatUntilAll) {
    const urls = new Set(records.map((r) => r.url));
    for (const url of [...cycle]) {
      if (!urls.has(url)) cycle.delete(url);
    }
    const remaining = records.filter((r) => !cycle.has(r.url));
    if (remaining.length === 0) {
      cycle = new Set();
      pool = records;
    } else {
      pool = remaining;
    }
  }

  const totalWeight = pool.reduce(
    (sum, record) => sum + Math.max(1, weights[record.url] ?? record.weight ?? 1),
    0
  );
  let roll = Math.random() * totalWeight;
  let chosen = pool[pool.length - 1];
  for (const record of pool) {
    roll -= Math.max(1, weights[record.url] ?? record.weight ?? 1);
    if (roll <= 0) {
      chosen = record;
      break;
    }
  }

  if (noRepeatUntilAll && chosen) {
    cycle.add(chosen.url);
    saveCycleSet(cycle, storage);
  }

  return chosen;
}

module.exports = {
  CYCLE_KEY,
  loadCycleSet,
  saveCycleSet,
  clearCycleSet,
  drawWeightedRecord
};
