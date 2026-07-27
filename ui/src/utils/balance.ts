// Shared balance-display resolution for every surface that shows the
// KrowdKredits balance (profile tile, StatsPanel hero, Topbar pill).
// KKCredits is the source of truth; a locally cached number is a legitimate
// fallback while the live figure loads, but an unknown balance must never
// render as a fabricated 0.
export type BalanceDisplay =
  | { kind: 'value'; n: number }
  | { kind: 'cached'; n: number }
  | { kind: 'unavailable' };

export function resolveBalance(
  fetched: number | null | undefined,
  cached: number | null | undefined,
): BalanceDisplay {
  if (typeof fetched === 'number') return { kind: 'value', n: fetched };
  if (typeof cached === 'number') return { kind: 'cached', n: cached };
  return { kind: 'unavailable' };
}

export function balanceText(display: BalanceDisplay): string {
  return display.kind === 'unavailable' ? '-' : display.n.toLocaleString();
}
