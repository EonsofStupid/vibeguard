/** Small-N metrics: pass rates always travel with a Wilson 95% interval. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, +(c - h).toFixed(3)), Math.min(1, +(c + h).toFixed(3))];
}
export function recallAtK(ranked: string[], gold: Set<string>, k: number): number {
  if (!gold.size) return 0;
  return ranked.slice(0, k).filter((x) => gold.has(x)).length / gold.size;
}
