import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import {
  getHappenings, categoryLabel, HAPPENING_CATEGORIES,
  type Happening,
} from '../api/happenings';
import { CalendarDays, MapPin, Phone, Globe, Store, Tag, X } from 'lucide-react';
import { Alert } from '../components/ui/Alert';
import { Spinner } from '../components/ui/Spinner';

// A calm bulletin board: chronological, no countdowns, no urgency. Posts clear
// themselves at end of day, so there is nothing to chase.
function postedAgo(createdAt: number): string {
  const mins = Math.floor((Date.now() / 1000 - createdAt) / 60);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
}

function mapHref(h: Happening): string {
  if (h.merchant_lat != null && h.merchant_lon != null) {
    return `https://www.google.com/maps/search/?api=1&query=${h.merchant_lat},${h.merchant_lon}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.merchant_address ?? '')}`;
}

function ContactBubble({ happening, onClose }: { happening: Happening; onClose: () => void }) {
  const h = happening;
  const hasContact = h.merchant_name || h.merchant_address || h.merchant_phone || h.merchant_website;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(30,51,32,0.55)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div className="card" style={{ background: 'var(--white)', padding: 24, maxWidth: 380, width: '100%' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <span style={{
            fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
            borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
          }}>
            {categoryLabel(h.category)}
          </span>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2 }}>
            <X size={18} />
          </button>
        </div>

        <p style={{ margin: '0 0 14px', fontSize: '0.95rem', color: 'var(--text)', lineHeight: 1.45 }}>{h.body}</p>

        {h.merchant_name && (
          <p style={{ margin: '0 0 10px', fontSize: '0.9rem', fontWeight: 600, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Store size={15} /> {h.merchant_name}
          </p>
        )}

        {hasContact ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {h.merchant_address && (
              <a href={mapHref(h)} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', color: 'var(--text)', textDecoration: 'none' }}>
                <MapPin size={15} style={{ color: 'var(--amber)', flexShrink: 0 }} />
                <span>{h.merchant_address}</span>
              </a>
            )}
            {h.merchant_phone && (
              <a href={`tel:${h.merchant_phone.replace(/[^0-9+]/g, '')}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', color: 'var(--text)', textDecoration: 'none' }}>
                <Phone size={15} style={{ color: 'var(--amber)', flexShrink: 0 }} />
                <span>{h.merchant_phone}</span>
              </a>
            )}
            {h.merchant_website && (
              <a href={h.merchant_website} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', color: 'var(--text)', textDecoration: 'none' }}>
                <Globe size={15} style={{ color: 'var(--amber)', flexShrink: 0 }} />
                <span>Visit website</span>
              </a>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>No contact details shared for this post.</p>
        )}
      </div>
    </div>
  );
}

export default function Happenings() {
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [items, setItems] = useState<Happening[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Happening | null>(null);

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await getHappenings(tenant.id, filter === 'all' ? undefined : filter);
        setItems(res.data || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load happenings.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, filter]);

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <CalendarDays size={22} /> Happenings
      </h1>
      <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        What's going on around the lakes today — straight from local businesses. The board
        clears each night, so it's always about right now.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      {/* Category filter — calm chips, no counts or badges */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12, WebkitOverflowScrolling: 'touch' }}>
        {[{ key: 'all', label: 'All' }, ...HAPPENING_CATEGORIES].map(c => (
          <button key={c.key} onClick={() => setFilter(c.key)}
            className={`btn btn-sm ${filter === c.key ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ paddingTop: 32, textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', background: 'var(--white)' }}>
          <CalendarDays size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
            {filter === 'all'
              ? 'Nothing posted yet today. Check back later — local businesses share updates here as the day goes on.'
              : `No ${categoryLabel(filter).toLowerCase()} happenings right now.`}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map(h => (
            <div key={h.id} className="card" role="button" tabIndex={0}
              onClick={() => setOpen(h)}
              onKeyDown={e => { if (e.key === 'Enter') setOpen(h); }}
              style={{ background: 'var(--white)', padding: 16, cursor: 'pointer', borderLeft: '4px solid var(--green)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                <span style={{
                  fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                  borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
                }}>
                  {categoryLabel(h.category)}
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{postedAgo(h.created_at)}</span>
              </div>

              <p style={{ margin: '0 0 8px', fontSize: '0.95rem', color: 'var(--text)', lineHeight: 1.45 }}>{h.body}</p>

              {h.photo_url && (
                <img src={h.photo_url} alt="" loading="lazy"
                  style={{ width: '100%', borderRadius: 'var(--r-md, 8px)', marginBottom: 8, maxHeight: 220, objectFit: 'cover' }} />
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {h.merchant_name ? (
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Store size={12} /> {h.merchant_name}
                  </span>
                ) : <span />}
                {h.deal && (
                  <button
                    className="btn btn-amber btn-sm"
                    style={{ minHeight: 30, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    onClick={e => { e.stopPropagation(); navigate('/deals'); }}>
                    <Tag size={12} /> Deal: {h.deal.title}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && <ContactBubble happening={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
