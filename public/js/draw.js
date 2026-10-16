const CYCLE_KEY = "nostrabotDrawCycle";

function loadCycleSet() {
  try {
    const raw = localStorage.getItem(CYCLE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (error) {
    return new Set();
  }
}

function saveCycleSet(set) {
  localStorage.setItem(CYCLE_KEY, JSON.stringify([...set]));
}

export function drawWeightedRecord(
  records,
  weights,
  { noRepeatUntilAll = false } = {}
) {
  if (!records?.length) return null;

  let pool = records;
  let cycle = loadCycleSet();

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
    saveCycleSet(cycle);
  }

  return chosen;
}
