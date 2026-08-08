import { ClipboardList } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Drawer } from 'kk-shared-ui';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { getBalance } from '../../api/credits';
import { Spinner } from '../ui/Spinner';
import { formatDate } from '../../utils/dates';
import { resolveBalance, balanceText } from '../../utils/balance';
import { ledgerLabel } from '../../utils/ledgerLabels';

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

function EmptyState() {
  return (
    <div className="card" style={{ padding: 32, textAlign: 'center', background: 'var(--white)' }}>
      <ClipboardList size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
        No activity yet - check back soon.
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

function CreditsContent({ tenantId, creditsName }: { tenantId: string; creditsName: string }) {
  const { user } = useAuth();
  const { data, isLoading, isError, isSuccess, refetch } = useQuery({
    queryKey: ['credits', tenantId],
    queryFn: () => getBalance(tenantId),
  });

  const balanceDisplay = resolveBalance(data?.data.balance, user?.credits_balance);
  // A 200 with balance: null means KKCredits itself was unreachable server-side -
  // an outage, not a real zero. Treat it the same as a client-side fetch failure.
  const creditsUnavailable = isError || (isSuccess && data?.data.balance == null);
  const history  = data?.data.history ?? [];

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
          {balanceText(balanceDisplay)}
        </div>
        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: '0.75rem', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          color: 'var(--muted)', marginTop: 6,
        }}>
          {creditsName} balance
        </div>
        {creditsUnavailable && (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.78rem', color: 'var(--muted)', margin: '8px 0 0' }}>
            Couldn't load right now.{' '}
            <button
              type="button"
              onClick={() => refetch()}
              style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--green)', textDecoration: 'underline', cursor: 'pointer' }}
            >
              Retry
            </button>
          </p>
        )}
      </div>

      <SectionLabel>Recent Activity</SectionLabel>

      {history.length === 0 ? (
        <EmptyState />
      ) : (
        history.map((entry, i) => (
          <div key={entry.id ?? i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '11px 0', borderBottom: '1px solid var(--border)',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.875rem', color: 'var(--green)' }}>
                {ledgerLabel(entry)}
              </div>
              {!!entry.created_at && (
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.72rem', color: 'var(--muted)' }}>
                  {formatDate(entry.created_at)}
                </div>
              )}
            </div>
            <span style={{
              fontFamily: 'var(--font-sans)', fontWeight: 'bold', fontSize: '0.9rem',
              color: entry.amount > 0 ? 'var(--sage)' : 'var(--muted)',
            }}>
              {entry.amount > 0 ? '+' : ''}{entry.amount}
            </span>
          </div>
        ))
      )}
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

  return (
    <Drawer open={open} onClose={onClose} side="right" ariaLabel={type ? panelTitle(type, creditsName) : 'Stats'}>
        {/* Header - close arrow points LEFT, matching every other right-side drawer */}
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
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 5 5 12 12 19"/>
            </svg>
          </button>
          <h2 data-drawer-heading style={{
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
    </Drawer>
  );
}
