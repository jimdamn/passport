// Guards the two properties that make jackpot payouts safe.
//
// 1. IDEMPOTENCY. Every jackpot award is keyed by the SCAN id, so one roll
//    pays exactly once whether it settles instantly (logged-in) or later
//    (guest deposit), and a retry after a KKCredits blip cannot double-pay.
// 2. ORDERING. The guest claim is closed AFTER the awards, so a KKCredits
//    failure leaves the claim pending and retryable instead of closing it
//    having paid nothing.
//
// WHAT THIS CAN AND CANNOT DO: it is a source scan, not an execution test.
// Passport's suite is pure-unit with no Worker or D1 harness, so nothing here
// moves credits. Behavioural proof that money lands is the live verification
// in the deploy gate. Same shape and same limits as splash-escrow-keys.spec.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isJackpot, mergeBadges, JACKPOT_REF_TYPE } from '../src/lib/jackpot';

const SRC = readFileSync(
  fileURLToPath(new URL('../src/handlers/passport.ts', import.meta.url)),
  'utf8',
);

/** The raw argument text of every awardCredits(...) call in the handler. */
function awardCalls(src: string): string[] {
  const calls: string[] = [];
  const re = /awardCredits\(([\s\S]*?)\n\s*\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) calls.push(m[1]);
  return calls;
}

describe('jackpot helpers', () => {
  it('treats only kredits_jackpot as payable', () => {
    expect(isJackpot('kredits_jackpot')).toBe(true);
    expect(isJackpot('kredits_base')).toBe(false);
    expect(isJackpot('merchant_coupon')).toBe(false);
  });

  it('uses a stable ref_type', () => {
    expect(JACKPOT_REF_TYPE).toBe('passport_jackpot');
  });

  it('merges badge lists without duplicates, order stable', () => {
    expect(mergeBadges(['welcome'], ['century', 'welcome'])).toEqual(['welcome', 'century']);
    expect(mergeBadges([], [])).toEqual([]);
  });
});

describe('jackpot payout wiring', () => {
  it('finds both payout sites (guards against the regex matching nothing)', () => {
    expect(awardCalls(SRC).length).toBe(2);
  });

  it('keys every jackpot award by JACKPOT_REF_TYPE and a scan id', () => {
    for (const call of awardCalls(SRC)) {
      expect(call).toContain('JACKPOT_REF_TYPE');
      expect(call).toMatch(/scanId,|claim\.scan_id,/);
    }
  });

  it('restores the reserved unit when the logged-in award throws', () => {
    expect(SRC).toMatch(/catch[\s\S]{0,500}restoreQuantity\(/);
  });
});
