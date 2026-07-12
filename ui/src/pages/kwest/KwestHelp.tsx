import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTenant } from '../../context/TenantContext';
import { getKwestHunts, getKwestRules, type KwestRules } from '../../api/kwest';
import RulesModal from '../../components/kwest/RulesModal';
import { Smartphone, MapPin, IdCard, Users, Compass, ScrollText, type LucideIcon } from 'lucide-react';

// ─── Section component (mirrors pages/Help.tsx) ────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{
        fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--green)',
        marginBottom: 12, paddingBottom: 8, borderBottom: '2px solid var(--border)',
      }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

// ─── Step indicator (mirrors pages/Help.tsx) ───────────────────────────────
function Step({ n, label, detail }: { n: number; label: string; detail: string }) {
  return (
    <div style={{ display: 'flex', gap: 14, marginBottom: 16, alignItems: 'flex-start' }}>
      <div style={{
        flexShrink: 0, width: 32, height: 32, borderRadius: '50%', background: 'var(--green)',
        color: 'var(--cream)', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: '0.9rem',
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2,
      }}>
        {n}
      </div>
      <div>
        <p style={{ fontWeight: 'bold', marginBottom: 3, fontSize: '0.95rem' }}>{label}</p>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--muted)', lineHeight: 1.55 }}>
          {detail}
        </p>
      </div>
    </div>
  );
}

// ─── Tip card (mirrors pages/Help.tsx) ─────────────────────────────────────
function Tip({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '14px 16px', marginBottom: 12 }}>
      <p style={{ fontWeight: 'bold', marginBottom: 4 }}>
        <Icon size={15} style={{ color: 'var(--amber)', verticalAlign: '-2px', marginRight: 6 }} />{title}
      </p>
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--muted)', lineHeight: 1.55 }}>
        {body}
      </p>
    </div>
  );
}

export default function KwestHelp() {
  const { tenant } = useTenant();
  const [rules, setRules] = useState<KwestRules | null>(null);
  const [showRules, setShowRules] = useState(false);

  // Rules text is versioned per hunt, but the short disclaimer and Official
  // Rules are the same document across hunts - any live/scheduled hunt's
  // /rules endpoint serves it. This help page loads it lazily when the
  // Official Rules button is opened, via whichever hunt is current, so we
  // just fetch the first hunt's rules on demand instead of hardcoding a slug.

  useEffect(() => {
    if (!tenant.id) return;
    // The rules text itself isn't hunt-specific copy, so any real slug will
    // do; if no hunt exists yet in this tenant the modal just shows a
    // loading state rather than erroring the whole help page.
    getKwestHunts(tenant.id)
      .then(res => {
        const slug = res.data?.[0]?.slug;
        if (slug) getKwestRules(tenant.id, slug).then(r => setRules(r.data)).catch(() => {});
      })
      .catch(() => {});
  }, [tenant.id]);

  return (
    <div className="main-content" style={{ maxWidth: 680, paddingTop: 24, paddingBottom: 80 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 className="page-title" style={{ fontFamily: 'var(--font-serif)', color: 'var(--green)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Compass size={22} style={{ color: 'var(--amber)' }} /> How KrowdKwest Works
        </h1>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.95rem', color: 'var(--muted)', lineHeight: 1.6 }}>
          KrowdKwest is a real-world clue hunt. You solve a clue, travel to the place it describes,
          and confirm you made it with your phone. No purchase is ever necessary to play.
        </p>
      </div>

      <Section title="What You Need">
        <Tip
          icon={Smartphone}
          title="A GPS-capable mobile device"
          body="KrowdKwest confirms your presence using your phone's location. A desktop computer can read the clues but cannot play - you'll need a phone with location services turned on."
        />
      </Section>

      <Section title="How to Play">
        <Step n={1} label="Read the clue" detail="Each stop is a short clue describing a real, public place." />
        <Step n={2} label="Travel there" detail="Figure out the spot and make your way to it. There's no map or compass in the app - just the clue." />
        <Step n={3} label="Confirm you're there" detail="Tap Reveal. Your phone checks your location, and if you're close enough, the next clue unlocks." />
        <Step n={4} label="Keep going" detail="Every solved clue pays real KrowdKredits. The last clue is the finish." />
      </Section>

      <Section title="Extra Surprises">
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.92rem', lineHeight: 1.6 }}>
          Every so often along the way, you might get the chance to play a quick bonus game
          for a few extra KrowdKredits. It's a nice surprise, never a requirement.
        </p>
      </Section>

      <Section title="How Winners Work">
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.92rem', lineHeight: 1.6, marginBottom: 16 }}>
          The first players to finish each hunt win a prize. The grand prize is a real prize plus
          KrowdKredits; the next finishers win KrowdKredits.
        </p>
        <Tip
          icon={IdCard}
          title="A photo ID is required for any physical prize"
          body="If you win a real prize, you'll need to show a valid photo ID in person to claim it. There are no exceptions."
        />
        <Tip
          icon={Users}
          title="Players under 18"
          body="Anyone can play, but a parent or guardian must hold the account and agree to the rules on behalf of a player under 18."
        />
        <Tip
          icon={MapPin}
          title="Play safely, in public places"
          body="Every hunt location is a real, publicly accessible spot. Never trespass, and always put your safety first - obey traffic laws and never use the app while driving."
        />
      </Section>

      <Section title="Before You Hunt">
        {rules ? (
          <p style={{
            fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--text)', lineHeight: 1.6,
            whiteSpace: 'pre-wrap', background: 'var(--white)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)', padding: '14px 16px', marginBottom: 16,
          }}>
            {rules.short_disclaimer}
          </p>
        ) : null}
        <button
          className="btn btn-secondary btn-sm"
          style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => setShowRules(true)}
        >
          <ScrollText size={14} /> Official Rules
        </button>
      </Section>

      <div style={{ background: 'var(--green)', borderRadius: 'var(--r-lg)', padding: '24px 20px', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-serif)', color: 'var(--cream)', fontWeight: 'bold', fontSize: '1.05rem', marginBottom: 8 }}>
          Ready for the first clue?
        </p>
        <Link to="/kwest" className="btn btn-amber">
          See live hunts
        </Link>
      </div>

      <RulesModal open={showRules} onClose={() => setShowRules(false)} rules={rules} />
    </div>
  );
}
