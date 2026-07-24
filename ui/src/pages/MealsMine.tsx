import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  listMyMeals, createKitchen, updateKitchen, setKitchenVisibility, deleteKitchen,
  createMeal, updateMeal, setMealSoldOut, cancelMeal, deleteMeal,
  uploadMealPhoto, MEAL_CATEGORIES, REGION_CENTER, REGION_BOUNDS,
  type MyKitchen, type MyMeal, type KitchenInput, type MealInput,
} from '../api/meals';
import { geocodeAddress } from '../api/geocode';
import { UtensilsCrossed, Pencil, Trash2, Camera, X, Plus, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Alert } from '../components/ui/Alert';
import { RegionMap } from 'kk-shared-ui';

// Community Table's authenticated "My Kitchen" page (plan §5.5). Follows
// PopupsMine.tsx's vendor->stop nested conventions (serif header + amber
// icon, white .card rows with a green left accent, Spinner, Alert for guard
// errors - never toasts). Any signed-in local can run a kitchen here - no
// organization verification. Diff vs PopupsMine.tsx: the kitchen form HAS a
// pin (like FreshMine.tsx's stand form), and each meal is a single-date form
// (not a scheduled-days range) with a benefit_line field and a collapsed-by-
// default venue override section.

const NAME_MAX = 60;
const DESC_MAX = 280;
const PHONE_MAX = 25;
const ADDRESS_HINT_MAX = 120;
const VENUE_HINT_MAX = 120;
const TITLE_MAX = 60;
const BODY_MAX = 500;
const BENEFIT_MAX = 120;
const MAX_DAYS_AHEAD = 120;

const inputStyle = { minHeight: 40, margin: 0 } as const;
const labelStyle = { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 } as const;

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
// Photo picker - same pattern as FreshMine.tsx's / PopupsMine.tsx's PhotoField.
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
      setWarning('That photo is quite large (over 8 MB) - try a smaller one.');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setLocalPreview(objectUrl);
    setUploading(true);
    try {
      const res = await uploadMealPhoto(tenantId, file);
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
// Kitchen form - create + edit, one component. Has a pin (unlike Pop-Ups'
// vendor form) - fire halls, churches and Legion posts are a fixed place.
// ─────────────────────────────────────────────────────────────────────────────

function KitchenForm({ tenantId, editingKitchen, homeLocation, onCancel, onSaved }: {
  tenantId: string;
  editingKitchen: MyKitchen | null;
  homeLocation: { lat: number; lon: number } | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const initialCenter = useMemo(() => {
    if (editingKitchen) return { lat: editingKitchen.lat, lon: editingKitchen.lon };
    return homeLocation ?? REGION_CENTER;
  }, [editingKitchen, homeLocation]);

  const [name, setName] = useState(editingKitchen?.name ?? '');
  const [description, setDescription] = useState(editingKitchen?.description ?? '');
  const [addressHint, setAddressHint] = useState(editingKitchen?.address_hint ?? '');
  const [phone, setPhone] = useState(editingKitchen?.phone ?? '');
  const [photoUrl, setPhotoUrl] = useState<string | null>(editingKitchen?.photo_url ?? null);
  const [picked, setPicked] = useState(initialCenter);
  const [mapCenter, setMapCenter] = useState(initialCenter);
  const [formError, setFormError] = useState('');
  const [working, setWorking] = useState(false);

  const [locating, setLocating] = useState(false);
  const [locatedMatch, setLocatedMatch] = useState('');
  const [locateError, setLocateError] = useState('');

  const canSave = !!name.trim();

  async function handleLocate() {
    const addr = (addressHint ?? '').trim();
    if (!addr) {
      setLocateError('Type an address above first.');
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
      const body: KitchenInput = {
        name: name.trim(),
        description: description.trim() || null,
        lat: picked.lat,
        lon: picked.lon,
        address_hint: (addressHint ?? '').trim() || null,
        phone: phone.trim() || null,
        photo_url: photoUrl,
      };
      if (editingKitchen) {
        await updateKitchen(tenantId, editingKitchen.id, body);
      } else {
        await createKitchen(tenantId, body);
      }
      onSaved();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save your kitchen.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        {editingKitchen ? 'Edit Kitchen' : 'Set Up Our Kitchen'}
      </h3>

      {formError && <Alert type="error" style={{ marginBottom: 12 }}>{formError}</Alert>}

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Kitchen name</label>
        <input className="form-input" style={inputStyle} maxLength={NAME_MAX} value={name}
          placeholder="e.g. Union City Fire Department"
          onChange={e => setName(e.target.value)} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Description (optional)</label>
        <textarea className="form-input" rows={2} maxLength={DESC_MAX} value={description ?? ''}
          placeholder="A line or two about who you are."
          style={{ margin: 0, resize: 'vertical' }}
          onChange={e => setDescription(e.target.value)} />
      </div>

      <PhotoField tenantId={tenantId} value={photoUrl} onChange={setPhotoUrl} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Address</label>
          <input className="form-input" style={inputStyle} maxLength={ADDRESS_HINT_MAX} value={addressHint ?? ''}
            placeholder="Street Address, City, State"
            onChange={e => setAddressHint(e.target.value)} />
          <div style={{ marginTop: 6 }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={locating || !addressHint?.trim()}
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

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Pin</label>
        <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--muted)' }}>
          Drag the pin to the hall - the door people walk in.
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
          {working ? 'Saving...' : editingKitchen ? 'Save Changes' : 'Set up our kitchen'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Meal form - create + edit + "Serve it again" prefill, one component.
// ─────────────────────────────────────────────────────────────────────────────

interface MealSeed {
  title: string; body: string; category: string; open: string; close: string;
  benefit_line: string | null; lat: number | null; lon: number | null; venue_hint: string | null;
}

function MealForm({ tenantId, kitchenId, kitchenCenter, editingMeal, seed, onCancel, onSaved }: {
  tenantId: string;
  kitchenId: string;
  kitchenCenter: { lat: number; lon: number };
  editingMeal: MyMeal | null;
  seed: MealSeed | null; // "Serve it again" prefill - everything but date
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(editingMeal?.title ?? seed?.title ?? '');
  const [category, setCategory] = useState<string>(editingMeal?.category ?? seed?.category ?? '');
  const [date, setDate] = useState(editingMeal?.date ?? '');
  const [open, setOpen] = useState(editingMeal?.open ?? seed?.open ?? '16:00');
  const [close, setClose] = useState(editingMeal?.close ?? seed?.close ?? '19:00');
  const [body, setBody] = useState(editingMeal?.body ?? seed?.body ?? '');
  const [benefitLine, setBenefitLine] = useState(editingMeal?.benefit_line ?? seed?.benefit_line ?? '');
  const [photoUrl, setPhotoUrl] = useState<string | null>(editingMeal?.photo_url ?? null);

  const hasInitialOverride = (editingMeal?.lat ?? seed?.lat) != null;
  const [venueOpen, setVenueOpen] = useState(hasInitialOverride);
  const initialVenue = useMemo(() => {
    if (editingMeal?.lat != null && editingMeal?.lon != null) return { lat: editingMeal.lat, lon: editingMeal.lon };
    if (seed?.lat != null && seed?.lon != null) return { lat: seed.lat, lon: seed.lon };
    return kitchenCenter;
  }, [editingMeal, seed, kitchenCenter]);
  const [venuePicked, setVenuePicked] = useState(initialVenue);
  const [venueHint, setVenueHint] = useState(editingMeal?.venue_hint ?? seed?.venue_hint ?? '');

  const [formError, setFormError] = useState('');
  const [working, setWorking] = useState(false);

  const today = todayDateStr();
  const maxDate = addDaysToDateStr(today, MAX_DAYS_AHEAD);
  const canSave = title.trim().length >= 3 && !!category && !!date && !!open && !!close && open < close && body.trim().length > 0;

  async function handleSubmit() {
    if (working || !canSave) return;
    setWorking(true);
    setFormError('');
    try {
      const body_: MealInput = {
        title: title.trim(),
        body: body.trim(),
        category,
        date, open, close,
        benefit_line: benefitLine.trim() || null,
        lat: venueOpen ? venuePicked.lat : null,
        lon: venueOpen ? venuePicked.lon : null,
        venue_hint: venueOpen ? (venueHint.trim() || null) : null,
        photo_url: photoUrl,
      };
      if (editingMeal) {
        await updateMeal(tenantId, editingMeal.id, body_);
      } else {
        await createMeal(tenantId, kitchenId, body_);
      }
      onSaved();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save that meal.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        {editingMeal ? 'Edit Meal' : 'Post a Meal'}
      </h3>

      {formError && <Alert type="error" style={{ marginBottom: 12 }}>{formError}</Alert>}

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Title</label>
        <input className="form-input" style={inputStyle} maxLength={TITLE_MAX} value={title}
          placeholder="e.g. Lenten Fish Fry"
          onChange={e => setTitle(e.target.value)} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>What kind of meal</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {MEAL_CATEGORIES.map(c => (
            <button key={c.key} type="button"
              className={`btn btn-sm ${category === c.key ? 'btn-amber' : 'btn-secondary'}`}
              style={{ minHeight: 36 }}
              onClick={() => setCategory(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Date</label>
          <input type="date" className="form-input" style={inputStyle} min={today} max={maxDate} value={date}
            onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Open</label>
          <input type="time" className="form-input" style={inputStyle} value={open} onChange={e => setOpen(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Close</label>
          <input type="time" className="form-input" style={inputStyle} value={close} onChange={e => setClose(e.target.value)} />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>What's cooking ({body.length}/{BODY_MAX})</label>
        <textarea className="form-input" rows={3} maxLength={BODY_MAX} value={body}
          placeholder="What's cooking? Example: Fish, fries, slaw and dessert. $12 adults, $6 kids 10 and under. Drive-thru available."
          style={{ margin: 0, resize: 'vertical' }}
          onChange={e => setBody(e.target.value)} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Benefit line (optional)</label>
        <input className="form-input" style={inputStyle} maxLength={BENEFIT_MAX} value={benefitLine ?? ''}
          placeholder="Proceeds: new turnout gear"
          onChange={e => setBenefitLine(e.target.value)} />
        <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: 'var(--muted)' }}>
          Who does this meal help? Example: Proceeds go to new turnout gear - or - Benefit for the Miller family
        </p>
      </div>

      <PhotoField tenantId={tenantId} value={photoUrl} onChange={setPhotoUrl} />

      <div style={{ marginBottom: 16 }}>
        <button type="button" onClick={() => setVenueOpen(v => !v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
            padding: 0, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)',
          }}>
          {venueOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />} Different location?
        </button>
        {venueOpen && (
          <div style={{ marginTop: 10 }}>
            <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--muted)' }}>
              Serving somewhere other than your kitchen? Drag the pin there.
            </p>
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Venue hint (optional)</label>
              <input className="form-input" style={inputStyle} maxLength={VENUE_HINT_MAX} value={venueHint ?? ''}
                placeholder="e.g. St. Mary's parish hall"
                onChange={e => setVenueHint(e.target.value)} />
            </div>
            <RegionMap
              pickable
              picked={venuePicked}
              onPick={(lat, lon) => setVenuePicked({ lat, lon })}
              center={venuePicked}
              maxBounds={REGION_BOUNDS}
              zoom={12}
              height="260px"
            />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={working} style={{ minHeight: 40 }}>
          Cancel
        </button>
        <button className="btn btn-amber btn-sm" onClick={handleSubmit}
          disabled={working || !canSave}
          style={{ minHeight: 40 }}>
          {working ? 'Saving...' : editingMeal ? 'Save Changes' : 'Post the meal'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A single meal row (My Kitchen's per-kitchen meal list).
// ─────────────────────────────────────────────────────────────────────────────

function clockLabel(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${mStr} ${ampm}`;
}

function MealRow({ meal, tenantId, kitchenVisible, onChanged, onError, onEdit, onServeAgain }: {
  meal: MyMeal;
  tenantId: string;
  kitchenVisible: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
  onEdit: (meal: MyMeal) => void;
  onServeAgain: (meal: MyMeal) => void;
}) {
  const [working, setWorking] = useState(false);

  async function run(action: () => Promise<unknown>) {
    if (working) return;
    setWorking(true);
    try {
      await action();
      onChanged();
    } catch (err: any) {
      onError(err.message || 'That action failed.');
    } finally {
      setWorking(false);
    }
  }

  function handleRemove() {
    if (!window.confirm("Take this meal off the board completely? If it's cancelled, use Cancel it instead - that way neighbors see the change.")) return;
    run(() => deleteMeal(tenantId, meal.id));
  }

  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)' }}>{meal.title}</span>
        <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{clockLabel(meal.open)} - {clockLabel(meal.close)}</span>
      </div>
      <p style={{ margin: '0 0 4px', fontSize: '0.8rem', color: 'var(--muted)' }}>{meal.date}</p>
      {meal.benefit_line && (
        <p style={{ margin: '0 0 4px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--amber)' }}>{meal.benefit_line}</p>
      )}

      {meal.state === 'hidden_by_admin' ? (
        <Alert type="error" style={{ marginBottom: 8 }}>{meal.state_note}</Alert>
      ) : (
        <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: meal.state === 'serving_now' ? 'var(--sage)' : meal.state === 'today' || meal.state === 'sold_out' ? 'var(--amber)' : 'var(--muted)' }}>
          {meal.state_note}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(meal.state === 'upcoming' || meal.state === 'today') && kitchenVisible && (
          <>
            <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={() => onEdit(meal)}>
              <Pencil size={13} /> Edit
            </button>
            <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
              onClick={() => run(() => cancelMeal(tenantId, meal.id))}>
              Cancel it
            </button>
            <button className="btn btn-secondary btn-sm" disabled={working}
              style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={handleRemove}>
              <Trash2 size={13} /> Remove
            </button>
          </>
        )}
        {meal.state === 'serving_now' && kitchenVisible && (
          <>
            <button className="btn btn-amber btn-sm" disabled={working} style={{ minHeight: 32 }}
              onClick={() => run(() => setMealSoldOut(tenantId, meal.id))}>
              Sold out
            </button>
            <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
              onClick={() => run(() => cancelMeal(tenantId, meal.id))}>
              Cancel it
            </button>
          </>
        )}
        {meal.state === 'sold_out' && kitchenVisible && (
          <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
            onClick={() => run(() => cancelMeal(tenantId, meal.id))}>
            Cancel it
          </button>
        )}
        {(meal.state === 'done' || meal.state === 'cancelled') && meal.can_serve_again && (
          <button className="btn btn-amber btn-sm" disabled={working} style={{ minHeight: 32 }}
            onClick={() => onServeAgain(meal)}>
            Serve it again
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A single kitchen card: state line, Go quiet/Show + Edit + Remove, Post a
// meal, and its meal rows.
// ─────────────────────────────────────────────────────────────────────────────

function KitchenCard({ kitchen, tenantId, onRefetch, onEdit }: {
  kitchen: MyKitchen;
  tenantId: string;
  onRefetch: () => void;
  onEdit: (kitchen: MyKitchen) => void;
}) {
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [mealForm, setMealForm] = useState<{ editing: MyMeal | null; seed: MealSeed | null } | 'closed'>('closed');

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

  function handleRemoveKitchen() {
    if (!window.confirm("Remove this kitchen? Its meals go with it. This can't be undone from here.")) return;
    run(() => deleteKitchen(tenantId, kitchen.id));
  }

  const canManage = kitchen.state === 'visible' || kitchen.state === 'quiet';

  return (
    <div className="card" style={{ background: 'var(--white)', padding: 16, marginBottom: 16, borderLeft: '4px solid var(--green)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
        <span style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--green)' }}>{kitchen.name}</span>
      </div>

      {kitchen.photo_url && (
        <img src={kitchen.photo_url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, marginBottom: 10, display: 'block' }} />
      )}

      {kitchen.state === 'hidden_by_admin' ? (
        <Alert type="error" style={{ marginBottom: 10 }}>{kitchen.state_note}</Alert>
      ) : (
        <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: kitchen.state === 'quiet' ? 'var(--amber)' : 'var(--sage)' }}>
          {kitchen.state_note}
        </p>
      )}

      {error && <Alert type="error" style={{ marginBottom: 10 }}>{error}</Alert>}

      {canManage && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
            onClick={() => run(() => setKitchenVisibility(tenantId, kitchen.id, kitchen.state !== 'quiet'))}>
            {kitchen.state === 'quiet' ? 'Show' : 'Go quiet'}
          </button>
          <button className="btn btn-secondary btn-sm" disabled={working}
            style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={() => onEdit(kitchen)}>
            <Pencil size={13} /> Edit
          </button>
          <button className="btn btn-secondary btn-sm" disabled={working}
            style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={handleRemoveKitchen}>
            <Trash2 size={13} /> Remove
          </button>
        </div>
      )}
      {!canManage && (
        <div style={{ marginBottom: 14 }}>
          <button className="btn btn-secondary btn-sm" disabled={working}
            style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={handleRemoveKitchen}>
            <Trash2 size={13} /> Remove
          </button>
        </div>
      )}

      {mealForm !== 'closed' && kitchen.state === 'visible' && (
        <MealForm
          tenantId={tenantId}
          kitchenId={kitchen.id}
          kitchenCenter={{ lat: kitchen.lat, lon: kitchen.lon }}
          editingMeal={mealForm.editing}
          seed={mealForm.seed}
          onCancel={() => setMealForm('closed')}
          onSaved={() => { setMealForm('closed'); onRefetch(); }}
        />
      )}

      {mealForm === 'closed' && kitchen.state === 'visible' && (
        <div style={{ marginBottom: 14 }}>
          <button className="btn btn-secondary btn-sm" style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => setMealForm({ editing: null, seed: null })}>
            <Plus size={14} /> Post a meal
          </button>
        </div>
      )}

      {kitchen.meals.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>No meals on the board yet.</p>
      ) : (
        <div>
          {kitchen.meals.map(meal => (
            <MealRow
              key={meal.id}
              meal={meal}
              tenantId={tenantId}
              kitchenVisible={kitchen.state === 'visible'}
              onChanged={onRefetch}
              onError={setError}
              onEdit={m => setMealForm({ editing: m, seed: null })}
              onServeAgain={m => setMealForm({
                editing: null,
                seed: {
                  title: m.title, body: m.body, category: m.category, open: m.open, close: m.close,
                  benefit_line: m.benefit_line, lat: m.lat, lon: m.lon, venue_hint: m.venue_hint,
                },
              })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function MealsMine() {
  const { user } = useAuth();
  const { tenant } = useTenant();

  const [kitchens, setKitchens] = useState<MyKitchen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showKitchenForm, setShowKitchenForm] = useState(false);
  const [editingKitchen, setEditingKitchen] = useState<MyKitchen | null>(null);

  const hasLoadedOnce = useRef(false);

  async function fetchMine() {
    if (!tenant) return;
    if (!hasLoadedOnce.current) setLoading(true);
    setError('');
    try {
      const res = await listMyMeals(tenant.id);
      setKitchens((res.data.kitchens || []).filter(k => k.state !== 'removed'));
    } catch (err: any) {
      setError(err.message || 'Failed to load your kitchens.');
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }

  useEffect(() => { fetchMine(); }, [tenant]);

  const homeLocation = user?.home_zip_lat != null && user?.home_zip_lon != null
    ? { lat: user.home_zip_lat, lon: user.home_zip_lon }
    : null;

  function openCreate() {
    setEditingKitchen(null);
    setShowKitchenForm(true);
  }

  function openEdit(kitchen: MyKitchen) {
    setEditingKitchen(kitchen);
    setShowKitchenForm(true);
  }

  function closeKitchenForm() {
    setShowKitchenForm(false);
    setEditingKitchen(null);
  }

  async function handleKitchenSaved() {
    closeKitchenForm();
    await fetchMine();
  }

  if (!user) {
    return (
      <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
        <div style={{ marginBottom: 8 }}>
          <Link to="/meals" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
            &larr; Back to Community Table
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
        <Link to="/meals" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Community Table
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <UtensilsCrossed size={22} style={{ color: 'var(--amber)' }} /> My Kitchen
      </h1>
      <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Manage your kitchen and post the meals you're serving.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      {loading ? (
        <div style={{ paddingTop: 32, textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          {showKitchenForm && (
            <KitchenForm
              key={editingKitchen ? editingKitchen.id : 'new'}
              tenantId={tenant!.id}
              editingKitchen={editingKitchen}
              homeLocation={homeLocation}
              onCancel={closeKitchenForm}
              onSaved={handleKitchenSaved}
            />
          )}

          {!showKitchenForm && kitchens.length === 0 && (
            <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
              <UtensilsCrossed size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
              <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
                Cooking for a crowd?
              </p>
              <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
                Set up your kitchen once - the fire hall, the church, the post. Then every breakfast, fish fry and benefit takes a minute to post.
              </p>
              <button className="btn btn-amber btn-sm" onClick={openCreate}>
                Set up our kitchen
              </button>
            </div>
          )}

          {!showKitchenForm && kitchens.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <button className="btn btn-secondary btn-sm" style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={openCreate}>
                  <Plus size={14} /> Add another kitchen
                </button>
              </div>
              {kitchens.map(kitchen => (
                <KitchenCard key={kitchen.id} kitchen={kitchen} tenantId={tenant!.id} onRefetch={fetchMine} onEdit={openEdit} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
