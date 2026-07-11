import { MapPin, IdCard, Users } from 'lucide-react';
import type { KwestRules } from '../../api/kwest';

interface Props {
  open: boolean;
  huntName: string;
  rules: KwestRules | null;
  onAgree: () => void;
  agreeing: boolean;
}

// Required gate before a hunt's first Reveal - not backdrop-dismissible,
// since agreement is mandatory, not optional. Bottom-sheet mechanics mirror
// QrDrawer.tsx, sized to fill nearly the whole screen (a rules gate, not a
// quick lookup).
export default function AckModal({ open, huntName, rules, onAgree, agreeing }: Props) {
  return (
    <>
      <div
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
          zIndex: 400, display: open ? 'block' : 'none', transition: 'opacity 0.25s ease',
        }}
      />
      <aside
        aria-label="Before you hunt"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, top: '5vh', maxWidth: 520, margin: '0 auto',
          background: 'var(--cream)', borderTopLeftRadius: 'var(--r-lg)', borderTopRightRadius: 'var(--r-lg)',
          borderTop: '1px solid var(--border)', boxShadow: '0 -4px 24px rgba(0,0,0,0.15)', zIndex: 401,
          display: 'flex', flexDirection: 'column',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.28s cubic-bezier(0.32,0.94,0.6,1)',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: 44, height: 5, background: '#ddd8cc', borderRadius: 3, margin: '10px auto 4px auto', flexShrink: 0 }} />

        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.15rem', fontWeight: 'bold', color: 'var(--green)', margin: 0 }}>
            Before you hunt
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>{huntName}</p>
        </div>

        <div style={{ overflowY: 'auto', padding: '20px', flex: 1 }}>
          {rules ? (
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 20 }}>
              {rules.short_disclaimer}
            </p>
          ) : (
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Loading...</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
            <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <MapPin size={16} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} />
              <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5 }}>
                <strong>You need a GPS-capable mobile device.</strong> This hunt is played by traveling to real places - a desktop or a phone with location services off cannot play.
              </p>
            </div>
            <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <IdCard size={16} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} />
              <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5 }}>
                <strong>Any physical prize requires a valid photo ID</strong>, checked in person, no exceptions.
              </p>
            </div>
            <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <Users size={16} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} />
              <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5 }}>
                <strong>Players under 18</strong> may join only with a parent or guardian, who holds the account and agrees to these rules on their behalf.
              </p>
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button
            className="btn btn-amber btn-block"
            style={{ minHeight: 44 }}
            disabled={!rules || agreeing}
            onClick={onAgree}
          >
            {agreeing ? 'One moment...' : 'I understand and agree'}
          </button>
        </div>
      </aside>
    </>
  );
}
