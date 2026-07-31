// Regression guard for the 2026-07-26 Social Splash escrow incident.
//
// WHAT WENT WRONG: makeSplashOffer escrowed the merchant's credits under the
// KKCredits idempotency key ('splash_offer_escrow', <submission_id>), while
// every escrow-OUT leg used <offer_id>. A submission can host more than one
// offer in sequence, so the second credits offer on a submission re-used the
// first one's escrow-in key. KKCredits matched it as a replay, returned 200
// having moved nothing, and passport recorded an offer it believed was funded.
// Withdrawing that offer ran its refund under a fresh key, which executed for
// real - paying 50 credits out of an escrow account holding nothing. Offers 2
// and 5, both on submission 4, did exactly this.
//
// WHAT THIS TEST CAN AND CANNOT DO: it is a source scan, not an execution test.
// Passport's suite is pure-unit with no Worker/D1 harness, so nothing here
// actually moves credits. It asserts the one property that, had it held, would
// have made the incident impossible: every leg of a Social Splash offer's money
// movement is keyed by that offer's own escrow_ref and never by a submission or
// offer id. It will NOT catch a new money path added in some other file, and it
// will NOT catch production drift. It catches a regression of this exact bug.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/handlers/${rel}`, import.meta.url)), 'utf8');
}

const SOURCES = ['splash-internal.ts', 'splash.ts'].map((f) => ({ file: f, src: read(f) }));

// The ref_type values that make up one offer's escrow lifecycle. Every call
// tagged with one of these must be keyed by the offer's escrow_ref.
const ESCROW_REF_TYPES = ['splash_offer_escrow', 'splash_offer_refund', 'splash_license'];

/** Every `'<ref_type>', <ref_id_expression>` pair appearing in a source file. */
function refPairs(src: string): Array<{ refType: string; refId: string }> {
  const pairs: Array<{ refType: string; refId: string }> = [];
  for (const refType of ESCROW_REF_TYPES) {
    const re = new RegExp(`'${refType}',\\s*([^\\n)]+?)\\s*[),]`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) pairs.push({ refType, refId: m[1].trim() });
  }
  return pairs;
}

describe('Social Splash escrow idempotency keys', () => {
  it('finds every escrow leg (guards against the regex silently matching nothing)', () => {
    const total = SOURCES.reduce((n, { src }) => n + refPairs(src).length, 0);
    // escrow-in, rollback refund, withdraw refund, sweep refund, pass refund, license settle
    expect(total).toBe(6);
  });

  it('keys every leg by the offer escrow_ref, never by a submission or offer id', () => {
    const offenders: string[] = [];
    for (const { file, src } of SOURCES) {
      for (const { refType, refId } of refPairs(src)) {
        const ok = refId === 'escrowRef' || /^offerEscrowRef\(/.test(refId);
        if (!ok) offenders.push(`${file}: '${refType}' keyed by \`${refId}\``);
      }
    }
    expect(
      offenders,
      `Social Splash escrow legs must be keyed by the offer's own escrow_ref.\n` +
        `A submission id is NOT unique per offer - that is the 2026-07-26 incident.\n` +
        offenders.join('\n')
    ).toEqual([]);
  });

  it('mints the escrow_ref before the money moves, not after', () => {
    const src = SOURCES[0].src;
    const mint = src.indexOf('const escrowRef = nanoid(');
    const escrowIn = src.indexOf("'splash_offer_escrow', escrowRef");
    expect(mint, 'escrowRef is no longer minted in splash-internal.ts').toBeGreaterThan(-1);
    expect(escrowIn, 'the escrow-in leg no longer uses escrowRef').toBeGreaterThan(-1);
    expect(mint).toBeLessThan(escrowIn);
  });

  it('treats a replayed escrow-in as a failure instead of recording an unfunded offer', () => {
    // The escrow_ref is freshly minted, so KKCredits can never legitimately
    // match it. If it says it did, no money moved - proceeding is what turns a
    // key collision into credits created from nothing.
    const src = SOURCES[0].src;
    expect(src).toMatch(/const \{ replayed \} = await transferCredits\(/);
    expect(src).toMatch(/if \(replayed\) \{/);
  });
});
