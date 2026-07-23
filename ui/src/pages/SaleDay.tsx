import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import {
  listSales, listSalePins, listSaleEvents, categoryLabel, saleLocation, SALE_CATEGORIES, REGION_CENTER,
  type SaleFeedRow, type SalePin, type SaleEventChip,
} from '../api/sales';
import { Signpost, List, Map as MapIcon, Phone, MapPin } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap, type RegionPin } from 'kk-shared-ui';

// Sale Day's public browse board. Follows Fresh Today's design language
// exactly (FreshToday.tsx is the visual donor) - serif header, calm chip
// rows, white cards with a green left accent, centered spinner, calm empty
// state, 800px column. Diff vs Fresh Today: an event chip row replaces the
// season strip, and there is no distance/near-me filter (not in the plan's
// §5.2 scope for Sale Day).

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

export default function SaleDay() {
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [sales, setSales] = useState<SaleFeedRow[]>([]);
  const [pins, setPins] = useState<SalePin[]>([]);
  const [events, setEvents] = useState<SaleEventChip[]>([]);
  const [category, setCategory] = useState<string>('all');
  const [eventFilter, setEventFilter] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Pins and event chips don't depend on the category/event filter - load
  // once per tenant, independent of the feed refetch below (same pattern as
  // FreshToday.tsx's seasons/stands effect).
  useEffect(() => {
    if (!tenant) return;
    listSaleEvents(tenant.id).then(res => setEvents(res.data || [])).catch(() => setEvents([]));
    listSalePins(tenant.id).then(res => setPins(res.data || [])).catch(() => setPins([]));
  }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await listSales(tenant.id, category === 'all' ? undefined : category, eventFilter ?? undefined);
        setSales(res.data || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load Sale Day.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, category, eventFilter]);

  const mapPins: RegionPin[] = useMemo(() => pins.map(p => ({
    id: p.id,
    lat: p.lat,
    lon: p.lon,
    label: p.title,
    sublabel: p.status_note,
    href: `/sales/sale/${p.id}`,
    kind: p.status === 'on_now' ? 'amber' : 'green',
  })), [pins]);

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Passport
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Signpost size={22} style={{ color: 'var(--amber)' }} /> Sale Day
      </h1>
      <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Yard sales, barn sales, estate sales and auctions - on the map before you head out.
      </p>

      {error && (
        <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--red, #b3352c)' }}>{error}</p>
      )}

      {/* Event chip row - the corridor-event feature (US-12 weekend). Omitted
          entirely when no event has 2+ visible sales. */}
      {events.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, WebkitOverflowScrolling: 'touch' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>This weekend:</span>
          {events.map(e => (
            <button key={e.event_name}
              onClick={() => setEventFilter(prev => prev === e.event_name ? null : e.event_name)}
              className={`btn btn-sm ${eventFilter === e.event_name ? 'btn-amber' : 'btn-secondary'}`}
              style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {e.event_name}
            </button>
          ))}
        </div>
      )}

      {/* Category filter - calm chips, no counts or badges */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, WebkitOverflowScrolling: 'touch' }}>
        {[{ key: 'all', label: 'All' }, ...SALE_CATEGORIES].map(c => (
          <button key={c.key} onClick={() => setCategory(c.key)}
            className={`btn btn-sm ${category === c.key ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {c.label}
          </button>
        ))}
      </div>

      {/* View toggle */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setView('list')}
          className={`btn btn-sm ${view === 'list' ? 'btn-amber' : 'btn-secondary'}`}
          style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <List size={14} /> List
        </button>
        <button onClick={() => setView('map')}
          className={`btn btn-sm ${view === 'map' ? 'btn-amber' : 'btn-secondary'}`}
          style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <MapIcon size={14} /> Map
        </button>
      </div>

      {loading ? (
        <div style={{ paddingTop: 32, textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      ) : view === 'map' ? (
        <RegionMap pins={mapPins} center={REGION_CENTER} height="60vh" />
      ) : sales.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <Signpost size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            No sales on the board right now.
          </p>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Sales show up here as neighbors post them - weekends fill up fast. Having one? Put it on the map in a minute.
          </p>
          <button className="btn btn-amber btn-sm" onClick={() => navigate('/sales/mine')}>
            Post my sale
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sales.map(s => (
            <div key={s.id} className="card" role="button" tabIndex={0}
              onClick={() => navigate(`/sales/sale/${s.id}`)}
              onKeyDown={e => { if (e.key === 'Enter') navigate(`/sales/sale/${s.id}`); }}
              style={{ background: 'var(--white)', padding: 16, cursor: 'pointer', borderLeft: '4px solid var(--green)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--green)' }}>{s.title}</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <span style={{
                    fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                    borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
                    whiteSpace: 'nowrap',
                  }}>
                    {categoryLabel(s.category)}
                  </span>
                  {s.event_name && (
                    <span style={{
                      fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                      borderRadius: 'var(--r-sm)', background: 'rgba(200,134,10,0.14)', color: 'var(--amber)',
                      whiteSpace: 'nowrap',
                    }}>
                      {s.event_name}
                    </span>
                  )}
                </div>
              </div>

              {saleLocation(s.nearest_city, s.nearest_state) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)' }}>
                  <MapPin size={12} style={{ color: 'var(--amber)' }} />
                  {saleLocation(s.nearest_city, s.nearest_state)}
                </div>
              )}

              <p style={{
                margin: '0 0 8px', fontSize: '1rem', color: 'var(--text)', lineHeight: 1.45,
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {s.body}
              </p>

              {s.photo_url && (
                <img src={s.photo_url} alt="" style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 8, display: 'block' }} />
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                  {truncate(s.address_hint ?? '', 60)}
                </span>
                {s.phone && (
                  <a href={`tel:${s.phone.replace(/[^0-9+]/g, '')}`}
                    onClick={e => e.stopPropagation()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--text)', textDecoration: 'none' }}>
                    <Phone size={12} style={{ color: 'var(--amber)' }} /> {s.phone}
                  </a>
                )}
              </div>

              <div style={{ marginTop: 8 }}>
                {(s.status === 'on_now' || s.status === 'ended') ? (
                  <Badge variant="amber">{s.status_note}</Badge>
                ) : (
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{s.status_note}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
