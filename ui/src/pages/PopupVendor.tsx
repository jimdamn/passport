import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { getPopupVendor, categoryLabel, REGION_BOUNDS, type PopupVendorDetail, type PopupVendorStop } from '../api/popups';
import { Truck, Phone, Share2 } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap, type RegionPin } from 'kk-shared-ui/map';

// Pop-Ups' public vendor page - the fan page and the shareable object
// (POP-UPS-BUILD-PLAN.md §5.3). Donor: SaleDetail.tsx (Share buttons, map,
// layout conventions); the schedule list + two-layer map are this board's
// own addition, since Fresh Today/Sale Day have no analogous full-schedule view.

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

function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

function todayBoardDateStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function StopRow({ stop, isToday }: { stop: PopupVendorStop; isToday: boolean }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: '0.88rem', fontWeight: isToday ? 700 : 400, color: 'var(--text)' }}>
          {isToday ? 'Today' : dayLabel(stop.date)}
        </span>
        <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
          {clockLabel(stop.open)} - {clockLabel(stop.close)}
        </span>
      </div>
      {stop.event_name && (
        <span style={{
          display: 'inline-block', marginTop: 2, fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase',
          padding: '2px 8px', borderRadius: 'var(--r-sm)', background: 'rgba(200,134,10,0.14)', color: 'var(--amber)',
        }}>
          {stop.event_name}
        </span>
      )}
      {stop.address && (
        <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: 'var(--text)' }}>{stop.address}</p>
      )}
      {(stop.location_hint || stop.nearest_city) && (
        <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
          {[stop.location_hint, stop.nearest_city].filter(Boolean).join(' · ')}
        </p>
      )}
      {stop.note && <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: 'var(--text)' }}>{stop.note}</p>}
      <div style={{ marginTop: 4 }}>
        {stop.status === 'here_now' ? (
          <Badge variant="green">{stop.status_note}</Badge>
        ) : stop.status === 'sold_out' ? (
          <Badge variant="amber">{stop.status_note}</Badge>
        ) : (
          <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>{stop.status_note}</span>
        )}
      </div>
    </div>
  );
}

export default function PopupVendor() {
  const { id } = useParams<{ id: string }>();
  const { tenant } = useTenant();

  const [vendor, setVendor] = useState<PopupVendorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!tenant || !id) return;
    setLoading(true);
    setNotFound(false);
    getPopupVendor(tenant.id, id)
      .then(res => setVendor(res.data))
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

  if (notFound || !vendor) {
    return (
      <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
        <div style={{ marginBottom: 8 }}>
          <Link to="/popups" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
            &larr; Back to Pop-Ups
          </Link>
        </div>
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <Truck size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: 0, color: 'var(--text)', fontSize: '0.9rem' }}>
            That vendor isn't on the board.
          </p>
        </div>
      </div>
    );
  }

  const today = todayBoardDateStr();

  const mapPins: RegionPin[] = vendor.stops.map(s => ({
    id: s.id,
    lat: s.checkin_lat ?? s.lat,
    lon: s.checkin_lon ?? s.lon,
    label: vendor.name,
    sublabel: s.status_note,
    href: `/popups/vendor/${vendor.id}`,
    kind: s.status === 'here_now' ? 'green' : 'amber',
  }));

  function handleFacebookShare() {
    const url = encodeURIComponent(window.location.href);
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'width=600,height=480,noopener,noreferrer');
  }

  function handleTwitterShare() {
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(vendor!.name);
    window.open(`https://x.com/intent/post?url=${url}&text=${text}`, '_blank', 'width=600,height=480,noopener,noreferrer');
  }

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/popups" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Pop-Ups
        </Link>
      </div>

      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Truck size={22} style={{ color: 'var(--amber)' }} /> {vendor.name}
      </h1>

      <div style={{ marginBottom: 8 }}>
        <span style={{
          fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
          borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
        }}>
          {categoryLabel(vendor.category)}
        </span>
      </div>

      {vendor.photo_url && (
        <img src={vendor.photo_url} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 8, marginBottom: 16, display: 'block' }} />
      )}

      {vendor.description && (
        <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.45 }}>
          {vendor.description}
        </p>
      )}

      {vendor.last_checked_in && (
        <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)', fontStyle: 'italic' }}>
          Last checked in: {weekdayFull(vendor.last_checked_in.date)} at {vendor.last_checked_in.location_hint || vendor.last_checked_in.nearest_city}.
        </p>
      )}

      {vendor.phone && (
        <a href={`tel:${vendor.phone.replace(/[^0-9+]/g, '')}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text)', textDecoration: 'none', marginBottom: 16 }}>
          <Phone size={14} style={{ color: 'var(--amber)' }} /> {vendor.phone}
        </a>
      )}

      <div className="card" style={{ background: 'var(--white)', padding: 16, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '0.9rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>Where to find us</h3>
        {vendor.stops.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>Nothing scheduled right now - check back.</p>
        ) : (
          vendor.stops.map(s => <StopRow key={s.id} stop={s} isToday={s.date === today} />)
        )}
      </div>

      {vendor.stops.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <RegionMap
            pins={mapPins}
            center={{ lat: mapPins[0].lat, lon: mapPins[0].lon }}
            maxBounds={REGION_BOUNDS}
            zoom={12}
            height="240px"
          />
        </div>
      )}

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
