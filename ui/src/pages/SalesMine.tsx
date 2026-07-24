import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  listMySales, createSale, updateSale, setSaleVisibility, wrapSale, deleteSale, uploadSalePhoto,
  categoryLabel, SALE_CATEGORIES, REGION_CENTER, REGION_BOUNDS,
  type MySale, type SaleInput, type SaleDayEntry,
} from '../api/sales';
import { geocodeAddress } from '../api/geocode';
import { Signpost, Pencil, Trash2, Camera, X, Plus, Info } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Alert } from '../components/ui/Alert';
import { RegionMap, resizeForUpload } from 'kk-shared-ui';

// Sale Day's authenticated "My Sales" page. Follows FreshMine.tsx's visual
// conventions exactly (serif header + amber icon, white .card rows with a
// green left accent, Spinner, Alert for guard errors - never toasts). Any
// signed-in local can post a sale here - no merchant verification.

const TITLE_MAX = 60;
const BODY_MAX = 500;
const ADDRESS_HINT_MAX = 120;
const PHONE_MAX = 25;
const EVENT_NAME_MAX = 60;
const MAX_DAYS = 5;
const MAX_DAYS_AHEAD = 60;

const inputStyle = { minHeight: 40, margin: 0 } as const;
const labelStyle = { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 } as const;

// Client-side warning only, over ~8 MB - never a hard block (image-api
// enforces the real cap server-side regardless).
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function todayDateStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo picker - same pattern as FreshMine.tsx's PhotoField.
// ─────────────────────────────────────────────────────────────────────────────

function PhotoField({ tenantId, value, onChange }: {
  tenantId: string;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [warning, setWarning] = useState('');

  const previewSrc = localPreview ?? value;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setWarning('');

    if (file.size > MAX_PHOTO_BYTES) {
      setWarning('That photo is over 8 MB - most phone photos are smaller. Try another one.');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setLocalPreview(objectUrl);
    setUploading(true);
    try {
      const optimized = await resizeForUpload(file);
      const res = await uploadSalePhoto(tenantId, optimized);
      onChange(res.data.url);
    } catch (err: any) {
      URL.revokeObjectURL(objectUrl);
      setLocalPreview(null);
      setWarning(err.message || "That photo didn't upload - you can still save without one.");
    } finally {
      setUploading(false);
    }
  }

  function handleRemove() {
    setLocalPreview(null);
    setWarning('');
    onChange(null);
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>Photo (optional)</label>
      {previewSrc && (
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}>
          <img src={previewSrc} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
          <button type="button" onClick={handleRemove} disabled={uploading} aria-label="Remove photo"
            style={{
              position: 'absolute', top: -8, right: -8, width: 24, height: 24, borderRadius: '50%',
              background: 'var(--white)', border: '1px solid var(--border)', color: 'var(--error)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
            }}>
            <X size={14} />
          </button>
        </div>
      )}
      <div>
        <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} disabled={uploading} />
        <button type="button" className="btn btn-secondary btn-sm" disabled={uploading}
          style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => inputRef.current?.click()}>
          <Camera size={14} /> {uploading ? 'Uploading...' : previewSrc ? 'Change photo' : 'Add a photo'}
        </button>
      </div>
      {warning && <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--error)' }}>{warning}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Days editor - up to 5 rows of date + open + close.
// ─────────────────────────────────────────────────────────────────────────────

function DaysEditor({ days, onChange }: { days: SaleDayEntry[]; onChange: (days: SaleDayEntry[]) => void }) {
  const today = todayDateStr();
  const maxDate = addDaysToDateStr(today, MAX_DAYS_AHEAD);

  function updateRow(i: number, patch: Partial<SaleDayEntry>) {
    onChange(days.map((d, idx) => idx === i ? { ...d, ...patch } : d));
  }

  function removeRow(i: number) {
    onChange(days.filter((_, idx) => idx !== i));
  }

  function addRow() {
    if (days.length >= MAX_DAYS) return;
    onChange([...days, { date: '', open: '09:00', close: '17:00' }]);
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>Sale days</label>
      <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--muted)' }}>
        Add each day you'll be open. You can always change them - rain happens.
      </p>
      {days.map((day, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <input type="date" className="form-input" style={{ ...inputStyle, flex: '1 1 140px' }}
            min={today} max={maxDate} value={day.date}
            onChange={e => updateRow(i, { date: e.target.value })} />
          <input type="time" className="form-input" style={{ ...inputStyle, flex: '1 1 100px' }}
            value={day.open} onChange={e => updateRow(i, { open: e.target.value })} />
          <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>to</span>
          <input type="time" className="form-input" style={{ ...inputStyle, flex: '1 1 100px' }}
            value={day.close} onChange={e => updateRow(i, { close: e.target.value })} />
          <button type="button" onClick={() => removeRow(i)} aria-label="Remove day"
            style={{
              width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--white)',
              color: 'var(--error)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
            }}>
            <X size={16} />
          </button>
        </div>
      ))}
      {days.length < MAX_DAYS && (
        <button type="button" className="btn btn-secondary btn-sm" style={{ minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={addRow}>
          <Plus size={14} /> Add a day
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sale form - create + edit, one component.
// ─────────────────────────────────────────────────────────────────────────────

interface SaleFormProps {
  tenantId: string;
  editingSale: MySale | null;
  prefillSale: MySale | null; // "Run it again" - everything but days
  homeLocation: { lat: number; lon: number } | null;
  onCancel: () => void;
  onSaved: () => void;
}

function SaleForm({ tenantId, editingSale, prefillSale, homeLocation, onCancel, onSaved }: SaleFormProps) {
  const seed = editingSale ?? prefillSale;

  const initialCenter = useMemo(() => {
    if (seed) return { lat: seed.lat, lon: seed.lon };
    return homeLocation ?? REGION_CENTER;
  }, [seed, homeLocation]);

  const [title, setTitle] = useState(seed?.title ?? '');
  const [body, setBody] = useState(seed?.body ?? '');
  const [category, setCategory] = useState<string>(seed?.category ?? '');
  const [addressHint, setAddressHint] = useState(seed?.address_hint ?? '');
  const [phone, setPhone] = useState(seed?.phone ?? '');
  const [eventName, setEventName] = useState(seed?.event_name ?? '');
  const [photoUrl, setPhotoUrl] = useState<string | null>(seed?.photo_url ?? null);
  const [days, setDays] = useState<SaleDayEntry[]>(editingSale ? editingSale.days : []);
  const [picked, setPicked] = useState(initialCenter);
  const [mapCenter, setMapCenter] = useState(initialCenter);
  const [formError, setFormError] = useState('');
  const [working, setWorking] = useState(false);

  const [locating, setLocating] = useState(false);
  const [locatedMatch, setLocatedMatch] = useState('');
  const [locateError, setLocateError] = useState('');

  const daysValid = days.length > 0 && days.every(d => d.date && d.open && d.close && d.open < d.close);
  const canSave = !!title.trim() && !!body.trim() && !!category && !!addressHint.trim() && daysValid;

  async function handleLocate() {
    const addr = addressHint.trim();
    if (!addr) {
      setLocateError('Type an address hint above first.');
      return;
    }
    setLocating(true);
    setLocateError('');
    setLocatedMatch('');
    try {
      const res = await geocodeAddress(tenantId, addr);
      setPicked({ lat: res.data.lat, lon: res.data.lon });
      setMapCenter({ lat: res.data.lat, lon: res.data.lon });
      setLocatedMatch(res.data.matched);
    } catch (err: any) {
      setLocateError(err.message || 'Include the full address - street, town, and state - so we can confirm it on the map.');
    } finally {
      setLocating(false);
    }
  }

  async function handleSubmit() {
    if (working || !canSave) return;
    setWorking(true);
    setFormError('');
    try {
      const input: SaleInput = {
        title: title.trim(),
        body: body.trim(),
        category,
        lat: picked.lat,
        lon: picked.lon,
        address_hint: addressHint.trim(),
        phone: phone.trim() || null,
        event_name: eventName.trim() || null,
        days,
        photo_url: photoUrl,
      };
      if (editingSale) {
        await updateSale(tenantId, editingSale.id, input);
      } else {
        await createSale(tenantId, input);
      }
      onSaved();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save your sale.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        {editingSale ? 'Edit Sale' : 'Post My Sale'}
      </h3>

      {formError && <Alert type="error" style={{ marginBottom: 12 }}>{formError}</Alert>}

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Sale title</label>
        <input className="form-input" style={inputStyle} maxLength={TITLE_MAX} value={title}
          placeholder="e.g. Miller Family Yard Sale"
          onChange={e => setTitle(e.target.value)} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>What's there</label>
        <textarea className="form-input" rows={3} maxLength={BODY_MAX} value={body}
          placeholder="What's there? Example: Tools, furniture, kids clothes, canning jars. Priced to go."
          style={{ margin: 0, resize: 'vertical' }}
          onChange={e => setBody(e.target.value)} />
        <p style={{ margin: '4px 0 0', fontSize: '0.7rem', color: 'var(--muted)', textAlign: 'right' }}>{body.length}/{BODY_MAX}</p>
      </div>

      <PhotoField tenantId={tenantId} value={photoUrl} onChange={setPhotoUrl} />

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Category</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SALE_CATEGORIES.map(c => (
            <button key={c.key} type="button"
              className={`btn btn-sm ${category === c.key ? 'btn-amber' : 'btn-secondary'}`}
              style={{ minHeight: 36 }}
              onClick={() => setCategory(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <DaysEditor days={days} onChange={setDays} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Address</label>
          <input className="form-input" style={inputStyle} maxLength={ADDRESS_HINT_MAX} value={addressHint ?? ''}
            placeholder="Street Address, City, State"
            onChange={e => setAddressHint(e.target.value)} />
          <div style={{ marginTop: 6 }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={locating || !addressHint.trim()}
              style={{ minHeight: 32 }}
              onClick={handleLocate}>
              {locating ? 'Locating...' : 'Locate on map'}
            </button>
            {locatedMatch && <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: 'var(--muted)' }}>Found: {locatedMatch}</p>}
            {locateError && (
              <div style={{
                marginTop: 6, padding: '8px 10px', display: 'flex', alignItems: 'flex-start', gap: 6,
                background: 'rgba(200,134,10,0.08)', border: '1px solid rgba(200,134,10,0.25)', borderRadius: 'var(--r-sm)',
              }}>
                <Info size={13} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text)' }}>{locateError}</p>
              </div>
            )}
          </div>
        </div>
        <div>
          <label style={labelStyle}>Phone (optional)</label>
          <input className="form-input" style={inputStyle} maxLength={PHONE_MAX} value={phone ?? ''}
            placeholder="e.g. 260-555-0110"
            onChange={e => setPhone(e.target.value)} />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Event name (optional)</label>
        <input className="form-input" style={inputStyle} maxLength={EVENT_NAME_MAX} value={eventName ?? ''}
          placeholder="e.g. US-12 Longest Garage Sale"
          onChange={e => setEventName(e.target.value)} />
        <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
          Part of a bigger sale weekend? Name it and your sale shows up with the rest. Example: US-12 Longest Garage Sale
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Sale location</label>
        <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--muted)' }}>
          Type an address above and tap Locate to jump the pin there, then drag it the rest of the way to the driveway.
        </p>
        <RegionMap
          pickable
          picked={picked}
          onPick={(lat, lon) => setPicked({ lat, lon })}
          center={mapCenter}
          maxBounds={REGION_BOUNDS}
          zoom={12}
          height="320px"
        />
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={working} style={{ minHeight: 40 }}>
          Cancel
        </button>
        <button className="btn btn-amber btn-sm" onClick={handleSubmit}
          disabled={working || !canSave}
          style={{ minHeight: 40 }}>
          {working ? 'Saving...' : editingSale ? 'Save Changes' : 'Post my sale'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A single sale card
// ─────────────────────────────────────────────────────────────────────────────

function SaleCard({ sale, tenantId, onRefetch, onEdit, onRunAgain }: {
  sale: MySale;
  tenantId: string;
  onRefetch: () => void;
  onEdit: (sale: MySale) => void;
  onRunAgain: (sale: MySale) => void;
}) {
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  async function run(action: () => Promise<unknown>) {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      await action();
      onRefetch();
    } catch (err: any) {
      setError(err.message || 'That action failed.');
    } finally {
      setWorking(false);
    }
  }

  function handleRemove() {
    if (!window.confirm("Take this sale off the board? This can't be undone from here.")) return;
    run(() => deleteSale(tenantId, sale.id));
  }

  const today = todayDateStr();
  const canWrapToday = sale.state === 'active' && sale.days.some(d => d.date === today);

  return (
    <div className="card" style={{ background: 'var(--white)', padding: 16, marginBottom: 16, borderLeft: '4px solid var(--green)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
        <span style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--green)' }}>{sale.title}</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span style={{
            fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
            borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
          }}>
            {categoryLabel(sale.category)}
          </span>
        </div>
      </div>

      {sale.photo_url && (
        <img src={sale.photo_url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, marginBottom: 10, display: 'block' }} />
      )}

      {sale.state === 'hidden_by_admin' ? (
        <Alert type="error" style={{ marginBottom: 10 }}>{sale.state_note}</Alert>
      ) : (
        <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: sale.state === 'postponed' ? 'var(--amber)' : 'var(--sage)' }}>
          {sale.state_note}
        </p>
      )}

      {error && <Alert type="error" style={{ marginBottom: 10 }}>{error}</Alert>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {sale.state === 'active' && (
          <>
            {canWrapToday && (
              <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
                onClick={() => run(() => wrapSale(tenantId, sale.id))}>
                Wrapped up for today
              </button>
            )}
            <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={() => onEdit(sale)}>
              <Pencil size={13} /> Edit
            </button>
            <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
              onClick={() => run(() => setSaleVisibility(tenantId, sale.id, true))}>
              Postpone
            </button>
            <button className="btn btn-secondary btn-sm" disabled={working}
              style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={handleRemove}>
              <Trash2 size={13} /> Remove
            </button>
          </>
        )}
        {sale.state === 'postponed' && (
          <>
            <button className="btn btn-amber btn-sm" disabled={working} style={{ minHeight: 32 }}
              onClick={() => run(() => setSaleVisibility(tenantId, sale.id, false))}>
              Show
            </button>
            <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={() => onEdit(sale)}>
              <Pencil size={13} /> Edit
            </button>
            <button className="btn btn-secondary btn-sm" disabled={working}
              style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={handleRemove}>
              <Trash2 size={13} /> Remove
            </button>
          </>
        )}
        {sale.state === 'ended' && (
          <button className="btn btn-amber btn-sm" disabled={working} style={{ minHeight: 32 }}
            onClick={() => onRunAgain(sale)}>
            Run it again
          </button>
        )}
        {sale.state === 'hidden_by_admin' && (
          <button className="btn btn-secondary btn-sm" disabled={working}
            style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={handleRemove}>
            <Trash2 size={13} /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function SalesMine() {
  const { user } = useAuth();
  const { tenant } = useTenant();

  const [sales, setSales] = useState<MySale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingSale, setEditingSale] = useState<MySale | null>(null);
  const [prefillSale, setPrefillSale] = useState<MySale | null>(null);

  const hasLoadedOnce = useRef(false);

  async function fetchMine() {
    if (!tenant) return;
    if (!hasLoadedOnce.current) setLoading(true);
    setError('');
    try {
      const res = await listMySales(tenant.id);
      setSales((res.data.sales || []).filter(s => s.state !== 'removed'));
    } catch (err: any) {
      setError(err.message || 'Failed to load your sales.');
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }

  useEffect(() => { fetchMine(); }, [tenant]);

  function openCreate() {
    setEditingSale(null);
    setPrefillSale(null);
    setShowForm(true);
  }

  function openEdit(sale: MySale) {
    setEditingSale(sale);
    setPrefillSale(null);
    setShowForm(true);
  }

  function openRunAgain(sale: MySale) {
    setEditingSale(null);
    setPrefillSale(sale);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingSale(null);
    setPrefillSale(null);
  }

  async function handleSaved() {
    closeForm();
    await fetchMine();
  }

  const homeLocation = (user?.home_zip_lat != null && user?.home_zip_lon != null)
    ? { lat: user.home_zip_lat, lon: user.home_zip_lon }
    : null;

  if (!user) {
    return (
      <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
        <div style={{ marginBottom: 8 }}>
          <Link to="/sales" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
            &larr; Back to Sale Day
          </Link>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ marginBottom: 16 }}>You are not signed in.</p>
          <a className="btn btn-primary" href="/auth/login">Sign In</a>
        </div>
      </div>
    );
  }

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/sales" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Sale Day
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Signpost size={22} style={{ color: 'var(--amber)' }} /> My Sales
      </h1>
      <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Manage your sales and let neighbors know when you're open.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      {loading ? (
        <div style={{ paddingTop: 32, textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          {showForm && (
            <SaleForm
              key={editingSale ? editingSale.id : prefillSale ? `again-${prefillSale.id}` : 'new'}
              tenantId={tenant!.id}
              editingSale={editingSale}
              prefillSale={prefillSale}
              homeLocation={homeLocation}
              onCancel={closeForm}
              onSaved={handleSaved}
            />
          )}

          {!showForm && sales.length === 0 && (
            <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
              <Signpost size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
              <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
                Got a sale coming up?
              </p>
              <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
                Put it on the region's map in about a minute. Neighbors plan their Saturday routes here.
              </p>
              <button className="btn btn-amber btn-sm" onClick={openCreate}>
                Post my sale
              </button>
            </div>
          )}

          {!showForm && sales.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <button className="btn btn-secondary btn-sm" style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={openCreate}>
                  <Plus size={14} /> Post my sale
                </button>
              </div>
              {sales.map(sale => (
                <SaleCard key={sale.id} sale={sale} tenantId={tenant!.id} onRefetch={fetchMine} onEdit={openEdit} onRunAgain={openRunAgain} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
