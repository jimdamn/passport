import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { getKitchen, categoryLabel, REGION_BOUNDS, type KitchenDetail } from '../api/meals';
import { UtensilsCrossed, Phone } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap, type RegionPin } from 'kk-shared-ui/map';

// Community Table's public kitchen page - the org profile (plan §5.4).
// Donor: PopupVendor.tsx's layout conventions. maxBounds on the map per
// ARCHITECTURE.md §13.10 item 1.

function clockLabel(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${mStr} ${ampm}`;
}

function dateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

function sinceLabel(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function KitchenPage() {
  const { id } = useParams<{ id: string }>();
  const { tenant } = useTenant();

  const [kitchen, setKitchen] = useState<KitchenDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!tenant || !id) return;
    setLoading(true);
    setNotFound(false);
    getKitchen(tenant.id, id)
      .then(res => setKitchen(res.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [tenant, id]);

  if (loading) {
    return (
      <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
        <div style={{ paddingTop: 32, textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (notFound || !kitchen) {
    return (
      <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
        <div style={{ marginBottom: 8 }}>
          <Link to="/meals" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
            &larr; Back to Community Table
          </Link>
        </div>
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <UtensilsCrossed size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: 0, color: 'var(--text)', fontSize: '0.9rem' }}>
            That kitchen isn't on the board.
          </p>
        </div>
      </div>
    );
  }

  const mapPins: RegionPin[] = [{
    id: kitchen.id,
    lat: kitchen.lat,
    lon: kitchen.lon,
    label: kitchen.name,
    sublabel: kitchen.address_hint ?? undefined,
    href: `/meals/kitchen/${kitchen.id}`,
    kind: 'green',
  }];

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/meals" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Community Table
        </Link>
      </div>

      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <UtensilsCrossed size={22} style={{ color: 'var(--amber)' }} /> {kitchen.name}
      </h1>

      {kitchen.photo_url && (
        <img src={kitchen.photo_url} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 8, marginBottom: 16, display: 'block' }} />
      )}

      {kitchen.description && (
        <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.45 }}>
          {kitchen.description}
        </p>
      )}

      {kitchen.address_hint && (
        <p style={{ margin: '0 0 8px', fontSize: '0.85rem', color: 'var(--text)' }}>{kitchen.address_hint}</p>
      )}

      {kitchen.phone && (
        <a href={`tel:${kitchen.phone.replace(/[^0-9+]/g, '')}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text)', textDecoration: 'none', marginBottom: 16 }}>
          <Phone size={14} style={{ color: 'var(--amber)' }} /> {kitchen.phone}
        </a>
      )}

      <div style={{ marginBottom: 20 }}>
        <RegionMap pins={mapPins} center={{ lat: kitchen.lat, lon: kitchen.lon }} maxBounds={REGION_BOUNDS} zoom={13} height="220px" />
      </div>

      <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        Upcoming meals
      </h3>

      {kitchen.meals.length === 0 ? (
        <p style={{ margin: '0 0 20px', fontSize: '0.85rem', color: 'var(--muted)' }}>Nothing posted right now - check back.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
          {kitchen.meals.map(m => (
            <Link key={m.id} to={`/meals/meal/${m.id}`} className="card" style={{
              display: 'block', background: 'var(--white)', padding: 16, borderLeft: '4px solid var(--green)',
              textDecoration: 'none', color: 'inherit',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--green)' }}>{m.title}</span>
                <span style={{
                  fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                  borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
                }}>
                  {categoryLabel(m.category)}
                </span>
              </div>
              <p style={{ margin: '0 0 4px', fontSize: '0.85rem', color: 'var(--text)' }}>
                {dateLabel(m.date)} · {clockLabel(m.open)} - {clockLabel(m.close)}
              </p>
              {m.benefit_line && (
                <p style={{ margin: '0 0 4px', fontSize: '0.82rem', fontWeight: 600, color: 'var(--amber)' }}>{m.benefit_line}</p>
              )}
              <div style={{ marginTop: 4 }}>
                {m.status === 'serving_now' ? (
                  <Badge variant="amber">{m.status_note}</Badge>
                ) : m.status === 'sold_out' ? (
                  <Badge variant="amber">Sold out</Badge>
                ) : m.status === 'cancelled' ? (
                  <Badge variant="gray">Cancelled</Badge>
                ) : (
                  <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>{m.status_note}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)', textAlign: 'center' }}>
        On Community Table since {sinceLabel(kitchen.created_at)}
      </p>
    </div>
  );
}
