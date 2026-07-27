import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { getMeal, categoryLabel, REGION_BOUNDS, type MealFeedRow } from '../api/meals';
import { UtensilsCrossed, Phone, Share2 } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap, type RegionPin } from 'kk-shared-ui/map';

// Community Table's public meal detail - the shareable page (plan §5.3).
// Donor: PopupVendor.tsx / SaleDetail.tsx (Share buttons, map, layout
// conventions). maxBounds on the single-pin map per ARCHITECTURE.md §13.10
// item 1 - every RegionMap instance, no exceptions.

function clockLabel(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${mStr} ${ampm}`;
}

function weekdayFull(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' });
}

function dateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

export default function MealDetail() {
  const { id } = useParams<{ id: string }>();
  const { tenant } = useTenant();

  const [meal, setMeal] = useState<MealFeedRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!tenant || !id) return;
    setLoading(true);
    setNotFound(false);
    getMeal(tenant.id, id)
      .then(res => setMeal(res.data))
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

  if (notFound || !meal) {
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
            That meal isn't on the board.
          </p>
        </div>
      </div>
    );
  }

  const mapPins: RegionPin[] = [{
    id: meal.id,
    lat: meal.lat,
    lon: meal.lon,
    label: meal.title,
    sublabel: meal.venue_hint ?? meal.kitchen.name,
    href: `/meals/meal/${meal.id}`,
    kind: (meal.status === 'serving_now' || meal.status === 'today') ? 'amber' : 'green',
  }];

  function handleFacebookShare() {
    const url = encodeURIComponent(window.location.href);
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'width=600,height=480,noopener,noreferrer');
  }

  function handleTwitterShare() {
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(meal!.title);
    window.open(`https://x.com/intent/post?url=${url}&text=${text}`, '_blank', 'width=600,height=480,noopener,noreferrer');
  }

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/meals" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Community Table
        </Link>
      </div>

      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <UtensilsCrossed size={22} style={{ color: 'var(--amber)' }} /> {meal.title}
      </h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
          borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
        }}>
          {categoryLabel(meal.category)}
        </span>
        {meal.status === 'serving_now' ? (
          <Badge variant="amber">{meal.status_note}</Badge>
        ) : meal.status === 'sold_out' ? (
          <Badge variant="amber">Sold out</Badge>
        ) : meal.status === 'cancelled' ? (
          <Badge variant="gray">Cancelled</Badge>
        ) : null}
      </div>

      <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: 'var(--text)' }}>
        {weekdayFull(meal.date)} {dateLabel(meal.date)} · {clockLabel(meal.open)} - {clockLabel(meal.close)}
      </p>

      {meal.benefit_line && (
        <p style={{
          margin: '0 0 16px', fontSize: '0.95rem', fontWeight: 600, color: 'var(--amber)',
          background: 'rgba(200,134,10,0.08)', padding: '10px 14px', borderRadius: 'var(--r-sm)',
        }}>
          {meal.benefit_line}
        </p>
      )}

      {meal.photo_url && (
        <img src={meal.photo_url} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 8, marginBottom: 16, display: 'block' }} />
      )}

      <p style={{ margin: '0 0 16px', fontSize: '1rem', color: 'var(--text)', lineHeight: 1.5 }}>{meal.body}</p>

      <div className="card" style={{ background: 'var(--white)', padding: 16, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '0.9rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>Where</h3>
        {meal.venue_hint && (
          <p style={{ margin: '0 0 4px', fontSize: '0.85rem', color: 'var(--text)' }}>{meal.venue_hint}</p>
        )}
        <Link to={`/meals/kitchen/${meal.kitchen.id}`} style={{ fontSize: '0.88rem', color: 'var(--amber)', fontWeight: 600 }}>
          {meal.kitchen.name}
        </Link>
        {meal.kitchen.phone && (
          <p style={{ margin: '8px 0 0' }}>
            <a href={`tel:${meal.kitchen.phone.replace(/[^0-9+]/g, '')}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text)', textDecoration: 'none' }}>
              <Phone size={14} style={{ color: 'var(--amber)' }} /> {meal.kitchen.phone}
            </a>
          </p>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <RegionMap pins={mapPins} center={{ lat: meal.lat, lon: meal.lon }} maxBounds={REGION_BOUNDS} zoom={13} height="240px" />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <button
          onClick={handleFacebookShare}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px',
            background: '#1877F2', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)',
            fontFamily: 'var(--font-sans)', fontSize: '0.85rem', fontWeight: 600,
            cursor: 'pointer', letterSpacing: '0.01em',
          }}
        >
          <Share2 size={15} /> Share on Facebook
        </button>
        <button
          onClick={handleTwitterShare}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px',
            background: '#000', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)',
            fontFamily: 'var(--font-sans)', fontSize: '0.85rem', fontWeight: 600,
            cursor: 'pointer', letterSpacing: '0.01em',
          }}
        >
          <Share2 size={15} /> Share on X
        </button>
      </div>
    </div>
  );
}
