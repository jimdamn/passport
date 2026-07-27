import { Link } from 'react-router-dom';
import type { ContentSummary, ContentSummarySource } from '../../api/content';

const FIELD_NOTES_SUBMIT_URL = 'https://fieldnotes.lakeandlocals.com/submit';
const EXCHANGE_NEW_OFFER_URL = 'https://exchange.lakeandlocals.com/offers/new';

interface Step {
  headline: string;
  cta: string;
  href: string;
  /** The content-summary source this step points at, so an already-used
   *  surface can skip the suggestion instead of pointing at what's already done. */
  sourceKey: keyof ContentSummary | null;
}

const SHARE_A_STORY: Step = {
  headline: "Share what's happening in your corner of the region.",
  cta: 'Share a story',
  href: FIELD_NOTES_SUBMIT_URL,
  sourceKey: 'field_notes',
};

// Locked copy: Gate D mockup board, "Next-step card, by pick" (approved
// 2026-07-27, https://claude.ai/code/artifact/f2ad12ea-33a4-4dc8-a2fb-60d1c736f900).
// A deterministic function of the member's own explicit Around Town pick -
// no inference from activity (ui/src/api/around.ts:14-18's standing rule).
// 'pets' has no natural "post" step (Home Safe is a break-glass feature, not
// something to steer a member toward) and isn't in the locked table, so it
// falls through to the same default as no pick, same as any future lens the
// picker adds ahead of the plan being amended.
const STEP_MAP: Partial<Record<string, Step>> = {
  fresh: {
    headline: "You told us fresh food matters most. My Stand puts what you're growing or making on the board.",
    cta: 'Set up my stand',
    href: '/fresh/mine',
    sourceKey: 'fresh',
  },
  sales: {
    headline: 'You told us sales matter most. My Sales lists your yard, barn, or moving sale.',
    cta: 'Post a sale',
    href: '/sales/mine',
    sourceKey: 'sales',
  },
  popups: {
    headline: 'You told us pop-ups matter most. My Schedule shows where your truck or shop is parked.',
    cta: 'Set up my vendor page',
    href: '/popups/mine',
    sourceKey: 'popups',
  },
  meals: {
    headline: 'You told us community meals matter most. My Kitchen shares what you’re serving.',
    cta: 'Set up our kitchen',
    href: '/meals/mine',
    sourceKey: 'meals',
  },
  events: SHARE_A_STORY,
  places: SHARE_A_STORY,
  deals: SHARE_A_STORY,
  hands: {
    headline: 'You told us volunteering matters most. The Exchange is where neighbors trade a hand.',
    cta: 'Open the Exchange',
    href: EXCHANGE_NEW_OFFER_URL,
    sourceKey: 'exchange',
  },
};

function sourceTotal(source: ContentSummarySource | undefined): number {
  return source ? Object.values(source.counts).reduce((a, b) => a + b, 0) : 0;
}

export default function NextStepCard({
  pick,
  contentSummary,
}: {
  pick: string | null;
  contentSummary: ContentSummary | undefined;
}) {
  // Content summary hasn't loaded yet - wait rather than flash a suggestion
  // that might immediately disappear once we know the surface is already used.
  if (!contentSummary) return null;

  const step = (pick && STEP_MAP[pick]) || SHARE_A_STORY;
  if (step.sourceKey && sourceTotal(contentSummary[step.sourceKey]) > 0) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', fontWeight: 'bold' }}>
        A good next step
      </h3>
      <p style={{ margin: '0 0 12px', fontSize: '0.88rem', color: 'var(--green)', lineHeight: 1.5, fontFamily: 'var(--font-sans)' }}>
        {step.headline}
      </p>
      <Link to={step.href} className="btn btn-primary btn-sm" style={{ textDecoration: 'none', display: 'inline-flex', color: 'var(--white)' }}>
        {step.cta}
      </Link>
    </div>
  );
}
