export function formatBlockNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return String(value == null ? '' : value);
  return n.toLocaleString('en-US');
}
