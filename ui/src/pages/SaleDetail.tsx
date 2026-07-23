import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { getSale, categoryLabel, saleLocation, type SaleFeedRow, type SaleDayEntry } from '../api/sales';
import { Signpost, Phone, MapPin, Share2 } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap } from 'kk-shared-ui';

// Sale Day's public detail page. Donor: FreshStand.tsx.

function clockLabel(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${mStr} ${ampm}`;
}

function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

function todayBoardDateStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function postedAt(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function DayRow({ day, isToday, isWrapped }: { day: SaleDayEntry; isToday: boolean; isWrapped: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0',
      borderBottom: '1px solid var(--border)',
      fontWeight: isToday ? 700 : 400,
      color: isWrapped ? 'var(--muted)' : 'var(--text)',
      textDecoration: isWrapped ? 'line-through' : 'none',
    }}>
      <span style={{ fontSize: '0.88rem' }}>{dayLabel(day.date)}</span>
      <span style={{ fontSize: '0.85rem' }}>{clockLabel(day.open)} - {clockLabel(day.close)}</span>
    </div>
  );
}

export default function SaleDetail() {
  const { id } = useParams<{ id: string }>();
  const { tenant } = useTenant();

  const [sale, setSale] = useState<SaleFeedRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!tenant || !id) return;
    setLoading(true);
    setNotFound(false);
    getSale(tenant.id, id)
      .then(res => setSale(res.data))
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

  if (notFound || !sale) {
    return (
      <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
        <div style={{ marginBottom: 8 }}>
          <Link to="/sales" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
            &larr; Back to Sale Day
          </Link>
        </div>
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <Signpost size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: 0, color: 'var(--text)', fontSize: '0.9rem' }}>
            That sale isn't on the board.
          </p>
        </div>
      </div>
    );
  }

  const today = todayBoardDateStr();

  function handleFacebookShare() {
    const url = encodeURIComponent(window.location.href);
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'width=600,height=480,noopener,noreferrer');
  }

  function handleTwitterShare() {
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(sale!.title);
    window.open(`https://x.com/intent/post?url=${url}&text=${text}`, '_blank', 'width=600,height=480,noopener,noreferrer');
  }

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/sales" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Sale Day
        </Link>
      </div>

      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Signpost size={22} style={{ color: 'var(--amber)' }} /> {sale.title}
      </h1>

      {saleLocation(sale.nearest_city, sale.nearest_state) && (
        <p style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <MapPin size={16} style={{ color: 'var(--amber)' }} /> {saleLocation(sale.nearest_city, sale.nearest_state)}
        </p>
      )}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{
          fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
          borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
        }}>
          {categoryLabel(sale.category)}
        </span>
        {sale.event_name && (
          <span style={{
            fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
            borderRadius: 'var(--r-sm)', background: 'rgba(200,134,10,0.14)', color: 'var(--amber)',
          }}>
            {sale.event_name}
          </span>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <Badge variant={sale.status === 'on_now' || sale.status === 'ended' ? 'amber' : 'gray'}>{sale.status_note}</Badge>
      </div>

      {sale.photo_url && (
        <img src={sale.photo_url} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 8, marginBottom: 16, display: 'block' }} />
      )}

      <p style={{ margin: '0 0 16px', fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.45 }}>
        {sale.body}
      </p>

      <div className="card" style={{ background: 'var(--white)', padding: 16, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '0.9rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>Days &amp; hours</h3>
        {sale.days.map(day => (
          <DayRow key={day.date} day={day} isToday={day.date === today} isWrapped={sale.wrapped_date === day.date} />
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <RegionMap
          pins={[{ id: sale.id, lat: sale.lat, lon: sale.lon, label: sale.title, kind: 'green' }]}
          center={{ lat: sale.lat, lon: sale.lon }}
          zoom={13}
          height="240px"
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
        {sale.address_hint && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text)' }}>
            <MapPin size={14} style={{ color: 'var(--amber)' }} /> {sale.address_hint}
          </span>
        )}
        {sale.phone && (
          <a href={`tel:${sale.phone.replace(/[^0-9+]/g, '')}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text)', textDecoration: 'none' }}>
            <Phone size={14} style={{ color: 'var(--amber)' }} /> {sale.phone}
          </a>
        )}
      </div>

      <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--muted)' }}>
        Posted {postedAt(sale.created_at)}
      </p>

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
