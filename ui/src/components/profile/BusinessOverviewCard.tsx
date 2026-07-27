import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, ChevronRight, AlertCircle, QrCode, Megaphone } from 'lucide-react';
import { CrossAppLink } from 'kk-shared-ui';
import { getBusinessOverview } from '../../api/overview';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';

const HUB_URL = 'https://business.lakeandlocals.com';

function StarterRow({ icon: Icon, label, onClick, to }: { icon: typeof QrCode; label: string; onClick?: () => void; to?: string }) {
  const content = (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      minHeight: 44, padding: '8px 0', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--green)', fontWeight: 600 }}>
        <Icon size={16} strokeWidth={2} color="var(--sage)" aria-hidden="true" /> {label}
      </span>
      <ChevronRight size={15} color="var(--muted)" style={{ flexShrink: 0 }} />
    </div>
  );
  if (onClick) {
    return <button type="button" onClick={onClick} style={{ display: 'block', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>{content}</button>;
  }
  return <Link to={to!} style={{ textDecoration: 'none', display: 'block' }}>{content}</Link>;
}

export default function BusinessOverviewCard({ businessName, onShowQr }: { businessName: string; onShowQr: () => void }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['business-overview'],
    queryFn: getBusinessOverview,
    staleTime: 60_000,
  });

  // Gate 8.3: a newly verified merchant's first visit is five statements of
  // zero centred on "$0 in sales this week" - the moment motivation peaks,
  // greeted with nothing but absence. Swap in honest starters instead.
  const isAllZero = !!data
    && data.endorsements.pending === 0
    && data.pos.week_total_cents === 0
    && data.pos.open_storefront_orders === 0
    && data.pos.new_quote_requests === 0
    && data.bookings.upcoming_confirmed === 0
    && data.volunteer.active_listings === 0;

  // D3 (Gate 9): once anything is nonzero, collapse the five-row detail list
  // into one doorway row. Only the genuinely actionable counts feed the
  // badge - upcoming bookings and active volunteer listings are already
  // confirmed/live, not waiting on the merchant to do anything.
  const attentionTotal = data
    ? data.endorsements.pending + data.pos.open_storefront_orders + data.pos.new_quote_requests
    : 0;

  return (
    <div className="card" style={{ marginBottom: 16, minHeight: 100 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 8 }}>
        <LayoutDashboard size={17} strokeWidth={2} color="var(--amber)" aria-hidden="true" /> My Business
      </h3>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
          <Spinner size="md" />
        </div>
      ) : isError ? (
        <div style={{ marginBottom: 12 }}>
          <p style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 10px',
          }}>
            <AlertCircle size={15} strokeWidth={2} aria-hidden="true" /> Couldn't reach the Business Hub.
          </p>
          <button type="button" onClick={() => refetch()} className="btn btn-secondary btn-sm">
            Retry
          </button>
        </div>
      ) : isAllZero ? (
        <>
          <p style={{ margin: '0 0 2px', fontSize: '0.95rem', fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--font-sans)' }}>
            Your business is live
          </p>
          <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)' }}>
            Here's where to start:
          </p>
          <StarterRow icon={QrCode} label="Put your check-in QR by the register" onClick={onShowQr} />
          <StarterRow icon={Megaphone} label="Post today's happening" to="/merchant" />
          <StarterRow icon={LayoutDashboard} label="See your Merchant Dashboard" to="/merchant" />
        </>
      ) : data ? (
        <>
          <Link
            to="/merchant"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              minHeight: 44, padding: '8px 0', borderBottom: '1px solid var(--border)',
              textDecoration: 'none',
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', fontWeight: 600, color: 'var(--green)' }}>My Business</span>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.75rem', color: 'var(--muted)' }}>{businessName} · verified merchant</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {attentionTotal > 0 && (
                <Badge variant="amber">{attentionTotal} need{attentionTotal === 1 ? 's' : ''} attention</Badge>
              )}
              <ChevronRight size={15} color="var(--muted)" />
            </span>
          </Link>
          <StarterRow icon={QrCode} label="Display check-in QR" onClick={onShowQr} />
        </>
      ) : (
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 12 }}>
          Open the Business Hub to see today's activity across your tools.
        </p>
      )}

      <div style={{ marginTop: 12 }}>
        <CrossAppLink href={HUB_URL} label="Open Business Hub" subtitle="POS, bookings, endorsements, and volunteer tools" />
      </div>
    </div>
  );
}
