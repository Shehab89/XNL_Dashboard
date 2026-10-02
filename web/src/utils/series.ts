/** Small, pure helpers for weekly series. */

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Net tone in points: % positive − % negative. Null when there are too few items to say anything. */
export function net(pos: number, neg: number, n: number, min = 20): number | null {
  return n >= min ? (100 * (pos - neg)) / n : null;
}

/** Sum of the `size` complete weeks ending before index `end` (exclusive). */
export function windowSum(xs: number[], end: number, size: number) {
  return sum(xs.slice(Math.max(0, end - size), end));
}

/** Relative change of the last `size` complete weeks vs. the `size` weeks before. Null when the base is too small. */
export function change(xs: number[], end: number, size = 4, minBase = 20): number | null {
  const now = windowSum(xs, end, size);
  const before = windowSum(xs, end - size, size);
  return before >= minBase ? now / before - 1 : null;
}

/** Centered moving average, used only to draw calmer lines; the raw values stay available for tooltips. */
export function smooth(xs: number[], radius = 1): number[] {
  return xs.map((_, i) => {
    const part = xs.slice(Math.max(0, i - radius), i + radius + 1);
    return sum(part) / part.length;
  });
}

/** Index of the maximum. */
export const argmax = (xs: number[]) => xs.reduce((best, x, i) => (x > xs[best] ? i : best), 0);
