import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import {
  listPopups, listPopupPins, categoryLabel, POPUP_CATEGORIES, REGION_CENTER, REGION_BOUNDS,
  type PopupFeedStop, type PopupStopPin, type PopupWhen,
} from '../api/popups';
import { Truck, List, Map as MapIcon, Phone } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { RegionMap, type RegionPin } from 'kk-shared-ui';

// Pop-Ups' public browse board. Follows Fresh Today/Sale Day's design
// language exactly (serif header, calm chip rows, white cards with a green
// left accent, centered spinner, calm empty state, 800px column). The
// differentiator (POP-UPS-BUILD-PLAN.md §0/§1): a When row (Today/Coming up/
// All) sits above the category row, and both the list and the map carry two
// layers - green (checked in, verified) vs amber (on the schedule, a plan).

function clockLabel(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${mStr} ${ampm}`;
}

function todayBoardDateStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function tomorrowBoardDateStr(): string {
  const [y, m, d] = todayBoardDateStr().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function weekdayDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
}

function groupLabel(dateStr: string, today: string, tomorrow: string): string {
  if (dateStr === today) return 'Today';
  if (dateStr === tomorrow) return 'Tomorrow';
  return weekdayDateLabel(dateStr);
}

export default function PopupsBoard() {
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [stops, setStops] = useState<PopupFeedStop[]>([]);
  const [pins, setPins] = useState<PopupStopPin[]>([]);
  const [when, setWhen] = useState<PopupWhen | 'all'>('all');
  const [category, setCategory] = useState<string>('all');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const whenParam = when === 'all' ? undefined : when;
        const categoryParam = category === 'all' ? undefined : category;
        const [feedRes, pinsRes] = await Promise.all([
          listPopups(tenant.id, categoryParam, whenParam),
          listPopupPins(tenant.id, categoryParam, whenParam),
        ]);
        setStops(feedRes.data || []);
        setPins(pinsRes.data || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load Pop-Ups.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, when, category]);

  const today = todayBoardDateStr();
  const tomorrow = tomorrowBoardDateStr();

  const grouped = useMemo(() => {
    const groups: { label: string; stops: PopupFeedStop[] }[] = [];
    for (const s of stops) {
      const label = groupLabel(s.date, today, tomorrow);
      const existing = groups.find(g => g.label === label);
      if (existing) existing.stops.push(s);
      else groups.push({ label, stops: [s] });
    }
    return groups;
  }, [stops, today, tomorrow]);

  const mapPins: RegionPin[] = useMemo(() => pins.map(p => ({
    id: p.id,
    lat: p.lat,
    lon: p.lon,
    label: p.vendor_name,
    sublabel: p.status_note,
    href: `/popups/vendor/${p.vendor_id}`,
    kind: p.layer === 'confirmed' ? 'green' : 'amber',
  })), [pins]);

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Passport
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Truck size={22} style={{ color: 'var(--amber)' }} /> Pop-Ups
      </h1>
      <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Food trucks, pop-up shops and traveling vendors - where they are today, and where they'll be next.
      </p>

      {error && (
        <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--red, #b3352c)' }}>{error}</p>
      )}

      {/* When chips - the differentiator, first row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {[{ key: 'all', label: 'All' }, { key: 'today', label: 'Today' }, { key: 'coming', label: 'Coming up' }].map(w => (
          <button key={w.key} onClick={() => setWhen(w.key as PopupWhen | 'all')}
            className={`btn btn-sm ${when === w.key ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32 }}>
            {w.label}
          </button>
        ))}
      </div>

      {/* Category chips - second row */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8, WebkitOverflowScrolling: 'touch' }}>
        {[{ key: 'all', label: 'All' }, ...POPUP_CATEGORIES].map(c => (
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
        <>
          <RegionMap pins={mapPins} center={REGION_CENTER} maxBounds={REGION_BOUNDS} height="60vh" />
          <p style={{ margin: '10px 0 0', fontSize: '0.78rem', color: 'var(--muted)', textAlign: 'center' }}>
            Green means they've checked in - they're there. Amber is their schedule - plans change.
          </p>
        </>
      ) : stops.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
          <Truck size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
            Nobody's popped up yet.
          </p>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Food trucks, pop-up shops and market vendors post their stops here - today's and the week ahead. Run one? Put your schedule on the map.
          </p>
          <button className="btn btn-amber btn-sm" onClick={() => navigate('/popups/mine')}>
            Put my schedule on the map
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {grouped.map(group => (
            <div key={group.label}>
              <p style={{ margin: '0 0 8px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--muted)' }}>
                {group.label}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {group.stops.map(s => (
                  <div key={s.id} className="card" role="button" tabIndex={0}
                    onClick={() => navigate(`/popups/vendor/${s.vendor.id}`)}
                    onKeyDown={e => { if (e.key === 'Enter') navigate(`/popups/vendor/${s.vendor.id}`); }}
                    style={{ background: 'var(--white)', padding: 16, cursor: 'pointer', borderLeft: '4px solid var(--green)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--green)' }}>{s.vendor.name}</span>
                      <span style={{
                        fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                        borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
                        whiteSpace: 'nowrap',
                      }}>
                        {categoryLabel(s.vendor.category)}
                      </span>
                    </div>

                    <p style={{ margin: '0 0 4px', fontSize: '0.85rem', color: 'var(--text)' }}>
                      {clockLabel(s.open)} - {clockLabel(s.close)}
                    </p>

                    {(s.location_hint || s.nearest_city) && (
                      <p style={{ margin: '0 0 6px', fontSize: '0.8rem', color: 'var(--muted)' }}>
                        {[s.location_hint, s.nearest_city].filter(Boolean).join(' · ')}
                      </p>
                    )}

                    {s.note && (
                      <p style={{ margin: '0 0 8px', fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.4 }}>{s.note}</p>
                    )}

                    {s.vendor.photo_url && (
                      <img src={s.vendor.photo_url} alt="" style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8, marginBottom: 8, display: 'block' }} />
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div>
                        {s.status === 'here_now' ? (
                          <Badge variant="green">{s.status_note}</Badge>
                        ) : s.status === 'sold_out' ? (
                          <Badge variant="amber">{s.status_note}</Badge>
                        ) : (
                          <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{s.status_note}</span>
                        )}
                      </div>
                      {s.vendor.phone && (
                        <a href={`tel:${s.vendor.phone.replace(/[^0-9+]/g, '')}`}
                          onClick={e => e.stopPropagation()}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--text)', textDecoration: 'none' }}>
                          <Phone size={12} style={{ color: 'var(--amber)' }} /> {s.vendor.phone}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
