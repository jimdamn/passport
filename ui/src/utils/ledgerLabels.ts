// Plain-language display map for KrowdKredits ledger entries, keyed by the
// server's stable ref_type - never by the raw `reason` text, which varies by
// direction (KKCredits prefixes transfers with "Sent:"/"Received:") and is
// not a stable key. Unmapped ref_types fall back to the raw reason.
// Display-layer only - this never changes what the ledger stores.
export const LEDGER_REASON_LABEL: Record<string, string> = {
  splash_offer_escrow: 'Held while your photo offer is decided',
  splash_offer_refund: 'Offer not taken - returned to you',
  splash_license: 'Photo licensed - payment received',
  deal_refund: 'Deal payment returned to you',
};

export function ledgerLabel(entry: { reason: string; ref_type?: string | null }): string {
  const mapped = entry.ref_type ? LEDGER_REASON_LABEL[entry.ref_type] : undefined;
  return mapped ?? entry.reason;
}
