import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, ChevronRight, AlertCircle } from 'lucide-react';
import { getBusinessOverview } from '../../api/overview';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';

const HUB_URL = 'https://business.lakeandlocals.com';

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function Row({ label, badge, href }: { label: string; badge?: number; href?: string }) {
  const content = (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      padding: '9px 0', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--green)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {!!badge && <Badge variant="amber">{badge}</Badge>}
        {href && <ChevronRight size={15} color="var(--muted)" />}
      </div>
    </div>
  );
  return href ? (
    <a href={href} style={{ textDecoration: 'none', display: 'block' }}>{content}</a>
  ) : content;
}

export default function BusinessOverviewCard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['business-overview'],
    queryFn: getBusinessOverview,
    staleTime: 60_000,
  });

  return (
    <div className="card" style={{ marginBottom: 16, minHeight: 180 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 8 }}>
        <LayoutDashboard size={17} strokeWidth={2} color="var(--amber)" aria-hidden="true" /> Your Business at a Glance
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
      ) : data ? (
        <>
          <Row
            label={`${data.endorsements.pending} pending endorsement${data.endorsements.pending === 1 ? '' : 's'}`}
            badge={data.endorsements.pending}
            href={`${HUB_URL}/endorsements`}
          />
          <Row
            label={`${formatCents(data.pos.week_total_cents)} in sales this week (${data.pos.week_ticket_count})`}
          />
          <Row
            label={`${data.pos.open_storefront_orders + data.pos.new_quote_requests} open order${data.pos.open_storefront_orders + data.pos.new_quote_requests === 1 ? '' : 's'}`}
            badge={data.pos.open_storefront_orders + data.pos.new_quote_requests}
            href={`${HUB_URL}/pos`}
          />
          <Row
            label={`${data.bookings.upcoming_confirmed} upcoming booking${data.bookings.upcoming_confirmed === 1 ? '' : 's'}`}
            href={`${HUB_URL}/bookings`}
          />
          <Row
            label={`${data.volunteer.active_listings} active volunteer listing${data.volunteer.active_listings === 1 ? '' : 's'} (${data.volunteer.spots_filled}/${data.volunteer.spots_total} spots filled)`}
            href={`${HUB_URL}/volunteer`}
          />
        </>
      ) : (
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 12 }}>
          Open the Business Hub to see today's activity across your tools.
        </p>
      )}

      <a
        href={HUB_URL}
        style={{
          display: 'block', marginTop: 12, fontFamily: 'var(--font-sans)',
          fontSize: '0.85rem', fontWeight: 600, color: 'var(--green)',
        }}
      >
        Open Business Hub &rarr;
      </a>
    </div>
  );
}
