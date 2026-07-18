import { useEffect } from 'react';
import { ClipboardList } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '../../context/TenantContext';
import { getBalance } from '../../api/credits';
import { Spinner } from '../ui/Spinner';
import { formatDate } from '../../utils/dates';
import type { CreditEntry } from '../../types';

export type StatsPanelType = 'credits';

interface Props {
  open: boolean;
  type: StatsPanelType | null;
  onClose: () => void;
}

// ── Shared ────────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: 'var(--font-sans)', fontSize: '0.78rem', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.06em',
      color: 'var(--muted)', marginBottom: 10,
    }}>
      {children}
    </p>
  );
}

function ExampleDisclaimer() {
  return (
    <div style={{
      background: 'rgba(200,134,10,0.08)', border: '1px dashed var(--amber)',
      borderRadius: 'var(--r-sm)', padding: '10px 14px', marginBottom: 18,
      display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <ClipboardList size={16} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--amber)' }} />
      <p style={{
        fontFamily: 'var(--font-sans)', fontSize: '0.78rem',
        color: 'var(--amber)', margin: 0, lineHeight: 1.5,
        fontWeight: 600,
      }}>
        Example data shown below - your real activity will appear here once you have data to display.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
      <Spinner size="md" />
    </div>
  );
}

// ── Credits panel ─────────────────────────────────────────────────────────────

const PLACEHOLDER_CREDITS: CreditEntry[] = [
  { id: 'p1', amount: 25,  balance_after: 25, reason: 'Welcome bonus',    created_at: 0 },
  { id: 'p2', amount: -5,  balance_after: 20, reason: 'Offer boost',      created_at: 0 },
  { id: 'p3', amount: 10,  balance_after: 30, reason: 'Trade completed',  created_at: 0 },
];

function CreditsContent({ tenantId, creditsName }: { tenantId: string; creditsName: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['credits', tenantId],
    queryFn: () => getBalance(tenantId),
  });

  const balance  = data?.data.balance ?? 0;
  const history  = data?.data.history ?? [];
  const hasData  = history.length > 0;
  const rows     = hasData ? history : PLACEHOLDER_CREDITS;

  if (isLoading) return <LoadingState />;

  return (
    <>
      {/* Balance hero */}
      <div style={{
        background: 'rgba(200,134,10,0.07)', border: '1px solid var(--amber)',
        borderRadius: 'var(--r-md)', padding: '20px 16px', marginBottom: 20,
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: '2.8rem',
          fontWeight: 'bold', color: 'var(--amber)', lineHeight: 1,
        }}>
          {balance}
        </div>
        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: '0.75rem', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          color: 'var(--muted)', marginTop: 6,
        }}>
          {creditsName} balance
        </div>
      </div>

      <SectionLabel>Recent Activity</SectionLabel>

      {!hasData && <ExampleDisclaimer />}

      {rows.map((entry, i) => (
        <div key={entry.id ?? i} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '11px 0', borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.875rem', color: 'var(--green)' }}>
              {entry.reason}
            </div>
            {hasData && entry.created_at > 0 && (
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.72rem', color: 'var(--muted)' }}>
                {formatDate(entry.created_at)}
              </div>
            )}
          </div>
          <span style={{
            fontFamily: 'var(--font-sans)', fontWeight: 'bold', fontSize: '0.9rem',
            color: entry.amount > 0 ? 'var(--sage)' : 'var(--error)',
          }}>
            {entry.amount > 0 ? '+' : ''}{entry.amount}
          </span>
        </div>
      ))}
    </>
  );
}

// ── Panel title ───────────────────────────────────────────────────────────────

function panelTitle(type: StatsPanelType, creditsName: string): string {
  switch (type) {
    case 'credits': return creditsName;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StatsPanel({ open, type, onClose }: Props) {
  const { tenant } = useTenant();
  const creditsName = tenant?.config.credits_name ?? 'KrowdKredits';
  const tenantId    = tenant?.id ?? '';

  // Lock body scroll while open - mirrors ProfilePanel
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 200, display: open ? 'block' : 'none',
        }}
      />

      {/* Slide-in panel - from the LEFT */}
      <aside
        aria-label={type ? panelTitle(type, creditsName) : 'Stats'}
        aria-hidden={!open}
        {...(!open ? { inert: '' } : {})}
        style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: 'min(400px, 100vw)', background: 'var(--cream)',
          zIndex: 201, display: 'flex', flexDirection: 'column',
          paddingTop:    'max(16px, env(safe-area-inset-top))',
          paddingLeft:   'max(16px, env(safe-area-inset-left))',
          paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
          paddingRight: '16px',
          overflowY: 'auto',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease',
        }}
      >
        {/* Header - close arrow points RIGHT (dismiss to left) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexShrink: 0 }}>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--green)', width: 44, height: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 'var(--r-sm)', flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/>
              <polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
          <h2 style={{
            fontFamily: 'var(--font-serif)', fontSize: '1.15rem',
            fontWeight: 'bold', color: 'var(--green)', margin: 0,
          }}>
            {type ? panelTitle(type, creditsName) : ''}
          </h2>
        </div>

        {/* Content - only render when open to avoid unnecessary fetches */}
        {open && type === 'credits' && (
          <CreditsContent tenantId={tenantId} creditsName={creditsName} />
        )}
      </aside>
    </>
  );
}
