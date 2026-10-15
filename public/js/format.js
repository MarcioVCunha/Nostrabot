export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDate(value) {
  return new Date(value).toLocaleString("pt-BR");
}

export function getDisplayName(record) {
  if (record.name) return record.name;
  const raw = (record.pathname || "").split("/").pop() || "audio";
  const withoutTimestamp = raw.replace(/^\d+-/, "");
  return decodeURIComponent(withoutTimestamp);
}
