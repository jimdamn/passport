import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  listMyPopups, createPopupVendor, updatePopupVendor, setPopupVendorVisibility, deletePopupVendor,
  createPopupStop, updatePopupStop, checkInPopupStop, setPopupStopSoldOut, cancelPopupStop, deletePopupStop,
  uploadPopupPhoto, categoryLabel, POPUP_CATEGORIES, REGION_CENTER, REGION_BOUNDS,
  type MyPopupVendor, type MyPopupStop, type PopupVendorInput, type PopupStopInput,
} from '../api/popups';
import { geocodeAddress } from '../api/geocode';
import { Truck, Pencil, Trash2, Camera, X, Plus, MapPin, Info } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Alert } from '../components/ui/Alert';
import { RegionMap } from 'kk-shared-ui';

// Pop-Ups' authenticated "My Schedule" page (POP-UPS-BUILD-PLAN.md §5.4).
// Follows FreshMine.tsx's nested stand->posts conventions (serif header +
// amber icon, white .card rows with a green left accent, Spinner, Alert for
// guard errors - never toasts). Any signed-in local can run a vendor page
// here - no merchant verification. Diff vs FreshMine.tsx: the vendor form has
// no pin (deliberate - §1), and each stop is a full scheduled form (date +
// window + pin) rather than a one-line composer, plus the day-of "I'm here"
// check-in flow with a soft geolocation-or-drag fallback.

const NAME_MAX = 60;
const DESC_MAX = 280;
const PHONE_MAX = 25;
const ADDRESS_MAX = 120;
const HINT_MAX = 120;
const NOTE_MAX = 280;
const EVENT_NAME_MAX = 60;
const MAX_DAYS_AHEAD = 60;

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
      setWarning('That photo is quite large (over 8 MB) - try a smaller one.');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setLocalPreview(objectUrl);
    setUploading(true);
    try {
      const res = await uploadPopupPhoto(tenantId, file);
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
// Vendor form - create + edit, one component. No pin - the form says why.
// ─────────────────────────────────────────────────────────────────────────────

function VendorForm({ tenantId, editingVendor, onCancel, onSaved }: {
  tenantId: string;
  editingVendor: MyPopupVendor | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editingVendor?.name ?? '');
  const [category, setCategory] = useState<string>(editingVendor?.category ?? '');
  const [description, setDescription] = useState(editingVendor?.description ?? '');
  const [phone, setPhone] = useState(editingVendor?.phone ?? '');
  const [photoUrl, setPhotoUrl] = useState<string | null>(editingVendor?.photo_url ?? null);
  const [formError, setFormError] = useState('');
  const [working, setWorking] = useState(false);

  const canSave = !!name.trim() && !!category;

  async function handleSubmit() {
    if (working || !canSave) return;
    setWorking(true);
    setFormError('');
    try {
      const body: PopupVendorInput = {
        name: name.trim(),
        category,
        description: description.trim() || null,
        phone: phone.trim() || null,
        photo_url: photoUrl,
      };
      if (editingVendor) {
        await updatePopupVendor(tenantId, editingVendor.id, body);
      } else {
        await createPopupVendor(tenantId, body);
      }
      onSaved();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save your vendor page.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        {editingVendor ? 'Edit Vendor Page' : 'Set Up My Vendor Page'}
      </h3>

      {formError && <Alert type="error" style={{ marginBottom: 12 }}>{formError}</Alert>}

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Name</label>
        <input className="form-input" style={inputStyle} maxLength={NAME_MAX} value={name}
          placeholder="e.g. Smokehouse on Wheels"
          onChange={e => setName(e.target.value)} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>What are you</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {POPUP_CATEGORIES.map(c => (
            <button key={c.key} type="button"
              className={`btn btn-sm ${category === c.key ? 'btn-amber' : 'btn-secondary'}`}
              style={{ minHeight: 36 }}
              onClick={() => setCategory(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Description (optional)</label>
        <textarea className="form-input" rows={2} maxLength={DESC_MAX} value={description ?? ''}
          placeholder="A line or two about what you serve or sell."
          style={{ margin: 0, resize: 'vertical' }}
          onChange={e => setDescription(e.target.value)} />
      </div>

      <PhotoField tenantId={tenantId} value={photoUrl} onChange={setPhotoUrl} />

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Phone (optional)</label>
        <input className="form-input" style={inputStyle} maxLength={PHONE_MAX} value={phone ?? ''}
          placeholder="e.g. 260-555-0110"
          onChange={e => setPhone(e.target.value)} />
      </div>

      <p style={{ margin: '0 0 16px', fontSize: '0.78rem', color: 'var(--muted)' }}>
        No address needed - your location is wherever your next stop is.
      </p>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={working} style={{ minHeight: 40 }}>
          Cancel
        </button>
        <button className="btn btn-amber btn-sm" onClick={handleSubmit}
          disabled={working || !canSave}
          style={{ minHeight: 40 }}>
          {working ? 'Saving...' : editingVendor ? 'Save Changes' : 'Set up my vendor page'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stop form - create + edit + "Stop here again" prefill, one component.
// ─────────────────────────────────────────────────────────────────────────────

interface StopSeed {
  date: string; open: string; close: string; lat: number; lon: number;
  address: string | null; location_hint: string | null; note: string | null; event_name: string | null;
}

function StopForm({ tenantId, vendorId, editingStop, seed, defaultCenter, onCancel, onSaved }: {
  tenantId: string;
  vendorId: string;
  editingStop: MyPopupStop | null;
  seed: StopSeed | null; // "Stop here again" prefill - everything but date
  defaultCenter: { lat: number; lon: number };
  onCancel: () => void;
  onSaved: () => void;
}) {
  const initialCenter = useMemo(() => {
    if (editingStop) return { lat: editingStop.lat, lon: editingStop.lon };
    if (seed) return { lat: seed.lat, lon: seed.lon };
    return defaultCenter;
  }, [editingStop, seed, defaultCenter]);

  const [date, setDate] = useState(editingStop?.date ?? '');
  const [open, setOpen] = useState(editingStop?.open ?? seed?.open ?? '09:00');
  const [close, setClose] = useState(editingStop?.close ?? seed?.close ?? '17:00');
  const [address, setAddress] = useState(editingStop?.address ?? seed?.address ?? '');
  const [locationHint, setLocationHint] = useState(editingStop?.location_hint ?? seed?.location_hint ?? '');
  const [note, setNote] = useState(editingStop?.note ?? '');
  const [eventName, setEventName] = useState(editingStop?.event_name ?? seed?.event_name ?? '');
  const [picked, setPicked] = useState(initialCenter);
  const [mapCenter, setMapCenter] = useState(initialCenter);
  const [formError, setFormError] = useState('');
  const [working, setWorking] = useState(false);

  const [locating, setLocating] = useState(false);
  const [locatedMatch, setLocatedMatch] = useState('');
  const [locateError, setLocateError] = useState('');

  const today = todayDateStr();
  const maxDate = addDaysToDateStr(today, MAX_DAYS_AHEAD);
  const canSave = !!date && !!open && !!close && open < close && !!address.trim();

  async function handleLocate() {
    const addr = address.trim();
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
      const body: PopupStopInput = {
        date, open, close,
        lat: picked.lat, lon: picked.lon,
        address: address.trim(),
        location_hint: locationHint.trim() || null,
        note: note.trim() || null,
        event_name: eventName.trim() || null,
      };
      if (editingStop) {
        await updatePopupStop(tenantId, editingStop.id, body);
      } else {
        await createPopupStop(tenantId, vendorId, body);
      }
      onSaved();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save that stop.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        {editingStop ? 'Edit Stop' : 'Add a Stop'}
      </h3>

      {formError && <Alert type="error" style={{ marginBottom: 12 }}>{formError}</Alert>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 12 }}>
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
        <label style={labelStyle}>Address</label>
        <input className="form-input" style={inputStyle} maxLength={ADDRESS_MAX} value={address}
          placeholder="Street Address, City, State"
          onChange={e => setAddress(e.target.value)} />
        <div style={{ marginTop: 6 }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={locating || !address.trim()}
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

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Location hint (optional)</label>
        <input className="form-input" style={inputStyle} maxLength={HINT_MAX} value={locationHint ?? ''}
          placeholder="e.g. Legion parking lot, north side"
          onChange={e => setLocationHint(e.target.value)} />
        <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: 'var(--muted)' }}>
          Say it like you'd tell a regular. Example: Legion parking lot, north side
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Note (optional)</label>
        <textarea className="form-input" rows={2} maxLength={NOTE_MAX} value={note ?? ''}
          placeholder="Anything special this stop? Example: New smash burger this week. Card and cash."
          style={{ margin: 0, resize: 'vertical' }}
          onChange={e => setNote(e.target.value)} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Event name (optional)</label>
        <input className="form-input" style={inputStyle} maxLength={EVENT_NAME_MAX} value={eventName ?? ''}
          placeholder="e.g. Angola Farmers Market"
          onChange={e => setEventName(e.target.value)} />
        <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
          Part of a bigger event? Name it and your stop shows up with the rest. Example: Angola Farmers Market
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Pin</label>
        <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--muted)' }}>
          Type an address above and tap Locate to jump the pin there, then drag it the rest of the way to where you'll set up.
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
          {working ? 'Saving...' : editingStop ? 'Save Changes' : 'Add a stop'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// "I'm here" / "Fix my pin" check-in flow - single device geolocation prompt,
// then a small confirm map with drag-to-adjust; a denial/failure/out-of-bounds
// fix falls back to the same map centered on the scheduled pin, first-class,
// not an error state (rural GPS inside a metal trailer fails often).
// ─────────────────────────────────────────────────────────────────────────────

function CheckInFlow({ tenantId, stop, onCancel, onDone, onError }: {
  tenantId: string;
  stop: MyPopupStop;
  onCancel: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<'locating' | 'confirming'>('locating');
  const [picked, setPicked] = useState({ lat: stop.checkin_lat ?? stop.lat, lon: stop.checkin_lon ?? stop.lon });
  const [fellBack, setFellBack] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) {
      setFellBack(true);
      setPhase('confirming');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const inBounds = lat >= REGION_BOUNDS[0][1] && lat <= REGION_BOUNDS[1][1] && lon >= REGION_BOUNDS[0][0] && lon <= REGION_BOUNDS[1][0];
        if (inBounds) {
          setPicked({ lat, lon });
          setFellBack(false);
        } else {
          setFellBack(true);
        }
        setPhase('confirming');
      },
      () => {
        setFellBack(true);
        setPhase('confirming');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }, []);

  async function confirm() {
    if (working) return;
    setWorking(true);
    try {
      await checkInPopupStop(tenantId, stop.id, picked);
      onDone();
    } catch (err: any) {
      onError(err.message || 'Could not check you in - try again.');
    } finally {
      setWorking(false);
    }
  }

  if (phase === 'locating') {
    return (
      <div style={{ padding: '16px 0', textAlign: 'center' }}>
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 0' }}>
      <p style={{ margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        {fellBack
          ? "Couldn't get your location - no problem. Drag the pin to where you're set up."
          : "That you? Drag the pin if it's off - this exact spot is what fans see."}
      </p>
      <RegionMap
        pickable
        picked={picked}
        onPick={(lat, lon) => setPicked({ lat, lon })}
        center={picked}
        maxBounds={REGION_BOUNDS}
        zoom={14}
        height="240px"
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
        <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={working} style={{ minHeight: 36 }}>
          Cancel
        </button>
        <button className="btn btn-amber btn-sm" onClick={confirm} disabled={working} style={{ minHeight: 36 }}>
          {working ? 'Saving...' : "That's me"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A single stop row (My Schedule's per-vendor stop list).
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

function StopRow({ stop, tenantId, vendorVisible, onChanged, onError, onEdit, onRunAgain }: {
  stop: MyPopupStop;
  tenantId: string;
  vendorVisible: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
  onEdit: (stop: MyPopupStop) => void;
  onRunAgain: (stop: MyPopupStop) => void;
}) {
  const [working, setWorking] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);

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
    if (!window.confirm("Take this stop off the board completely? If plans changed, use Cancel it instead - that way fans see the change.")) return;
    run(() => deletePopupStop(tenantId, stop.id));
  }

  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)' }}>{stop.date}</span>
        <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{clockLabel(stop.open)} - {clockLabel(stop.close)}</span>
      </div>
      {stop.event_name && (
        <span style={{
          display: 'inline-block', marginBottom: 4, fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase',
          padding: '2px 8px', borderRadius: 'var(--r-sm)', background: 'rgba(200,134,10,0.14)', color: 'var(--amber)',
        }}>
          {stop.event_name}
        </span>
      )}
      {stop.address && (
        <p style={{ margin: '0 0 2px', fontSize: '0.8rem', color: 'var(--text)' }}>
          <MapPin size={11} style={{ verticalAlign: '-1px', marginRight: 3, color: 'var(--amber)' }} />
          {stop.address}
        </p>
      )}
      {(stop.location_hint || stop.nearest_city) && (
        <p style={{ margin: '0 0 4px', fontSize: '0.8rem', color: 'var(--muted)' }}>
          {[stop.location_hint, stop.nearest_city].filter(Boolean).join(' · ')}
        </p>
      )}

      {stop.state === 'hidden_by_admin' ? (
        <Alert type="error" style={{ marginBottom: 8 }}>{stop.state_note}</Alert>
      ) : (
        <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: stop.state === 'here_now' ? 'var(--sage)' : stop.state === 'today' || stop.state === 'scheduled_now' ? 'var(--amber)' : 'var(--muted)' }}>
          {stop.state_note}
        </p>
      )}

      {checkingIn ? (
        <CheckInFlow
          tenantId={tenantId}
          stop={stop}
          onCancel={() => setCheckingIn(false)}
          onDone={() => { setCheckingIn(false); onChanged(); }}
          onError={err => { setCheckingIn(false); onError(err); }}
        />
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {stop.state === 'upcoming' && vendorVisible && (
            <>
              <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                onClick={() => onEdit(stop)}>
                <Pencil size={13} /> Edit
              </button>
              <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
                onClick={() => run(() => cancelPopupStop(tenantId, stop.id))}>
                Cancel it
              </button>
              <button className="btn btn-secondary btn-sm" disabled={working}
                style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                onClick={handleRemove}>
                <Trash2 size={13} /> Remove
              </button>
            </>
          )}
          {(stop.state === 'today' || stop.state === 'scheduled_now') && vendorVisible && (
            <>
              <button className="btn btn-amber" disabled={working} style={{ minHeight: 40, fontWeight: 700 }}
                onClick={() => setCheckingIn(true)}>
                I'm here
              </button>
              <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                onClick={() => onEdit(stop)}>
                <Pencil size={13} /> Edit
              </button>
              <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
                onClick={() => run(() => cancelPopupStop(tenantId, stop.id))}>
                Cancel it
              </button>
            </>
          )}
          {stop.state === 'here_now' && vendorVisible && (
            <>
              <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
                onClick={() => setCheckingIn(true)}>
                Fix my pin
              </button>
              <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
                onClick={() => run(() => setPopupStopSoldOut(tenantId, stop.id))}>
                Sold out
              </button>
              <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
                onClick={() => run(() => cancelPopupStop(tenantId, stop.id))}>
                Cancel it
              </button>
            </>
          )}
          {(stop.state === 'done' || stop.state === 'cancelled') && stop.can_repeat && (
            <button className="btn btn-amber btn-sm" disabled={working} style={{ minHeight: 32 }}
              onClick={() => onRunAgain(stop)}>
              Stop here again
            </button>
          )}
          {stop.state === 'sold_out' && (
            <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
              onClick={() => run(() => cancelPopupStop(tenantId, stop.id))}>
              Cancel it
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A single vendor card: state line, Off the road/Back out + Edit + Remove,
// Add a stop, and its stop rows.
// ─────────────────────────────────────────────────────────────────────────────

function VendorCard({ vendor, tenantId, onRefetch, onEdit }: {
  vendor: MyPopupVendor;
  tenantId: string;
  onRefetch: () => void;
  onEdit: (vendor: MyPopupVendor) => void;
}) {
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [stopForm, setStopForm] = useState<{ editing: MyPopupStop | null; seed: StopSeed | null } | 'closed'>('closed');

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

  function handleRemoveVendor() {
    if (!window.confirm("Remove this vendor page? Its stops go with it. This can't be undone from here.")) return;
    run(() => deletePopupVendor(tenantId, vendor.id));
  }

  const canManage = vendor.state === 'visible' || vendor.state === 'off_road';

  const defaultStopCenter = vendor.stops.length > 0
    ? { lat: vendor.stops[0].lat, lon: vendor.stops[0].lon }
    : REGION_CENTER;

  return (
    <div className="card" style={{ background: 'var(--white)', padding: 16, marginBottom: 16, borderLeft: '4px solid var(--green)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
        <span style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--green)' }}>{vendor.name}</span>
        <span style={{
          fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
          borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
        }}>
          {categoryLabel(vendor.category)}
        </span>
      </div>

      {vendor.photo_url && (
        <img src={vendor.photo_url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, marginBottom: 10, display: 'block' }} />
      )}

      {vendor.state === 'hidden_by_admin' ? (
        <Alert type="error" style={{ marginBottom: 10 }}>{vendor.state_note}</Alert>
      ) : (
        <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: vendor.state === 'off_road' ? 'var(--amber)' : 'var(--sage)' }}>
          {vendor.state_note}
        </p>
      )}

      {error && <Alert type="error" style={{ marginBottom: 10 }}>{error}</Alert>}

      {canManage && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
            onClick={() => run(() => setPopupVendorVisibility(tenantId, vendor.id, vendor.state !== 'off_road'))}>
            {vendor.state === 'off_road' ? 'Back out' : 'Off the road'}
          </button>
          <button className="btn btn-secondary btn-sm" disabled={working}
            style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={() => onEdit(vendor)}>
            <Pencil size={13} /> Edit
          </button>
          <button className="btn btn-secondary btn-sm" disabled={working}
            style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={handleRemoveVendor}>
            <Trash2 size={13} /> Remove
          </button>
        </div>
      )}
      {!canManage && (
        <div style={{ marginBottom: 14 }}>
          <button className="btn btn-secondary btn-sm" disabled={working}
            style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={handleRemoveVendor}>
            <Trash2 size={13} /> Remove
          </button>
        </div>
      )}

      {stopForm !== 'closed' && vendor.state === 'visible' && (
        <StopForm
          tenantId={tenantId}
          vendorId={vendor.id}
          editingStop={stopForm.editing}
          seed={stopForm.seed}
          defaultCenter={defaultStopCenter}
          onCancel={() => setStopForm('closed')}
          onSaved={() => { setStopForm('closed'); onRefetch(); }}
        />
      )}

      {stopForm === 'closed' && vendor.state === 'visible' && (
        <div style={{ marginBottom: 14 }}>
          <button className="btn btn-secondary btn-sm" style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => setStopForm({ editing: null, seed: null })}>
            <Plus size={14} /> Add a stop
          </button>
        </div>
      )}

      {vendor.stops.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>No stops on the board yet.</p>
      ) : (
        <div>
          {vendor.stops.map(stop => (
            <StopRow
              key={stop.id}
              stop={stop}
              tenantId={tenantId}
              vendorVisible={vendor.state === 'visible'}
              onChanged={onRefetch}
              onError={setError}
              onEdit={s => setStopForm({ editing: s, seed: null })}
              onRunAgain={s => setStopForm({
                editing: null,
                seed: { date: '', open: s.open, close: s.close, lat: s.lat, lon: s.lon, address: s.address, location_hint: s.location_hint, note: null, event_name: s.event_name },
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

export default function PopupsMine() {
  const { user } = useAuth();
  const { tenant } = useTenant();

  const [vendors, setVendors] = useState<MyPopupVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [editingVendor, setEditingVendor] = useState<MyPopupVendor | null>(null);

  const hasLoadedOnce = useRef(false);

  async function fetchMine() {
    if (!tenant) return;
    if (!hasLoadedOnce.current) setLoading(true);
    setError('');
    try {
      const res = await listMyPopups(tenant.id);
      setVendors((res.data.vendors || []).filter(v => v.state !== 'removed'));
    } catch (err: any) {
      setError(err.message || 'Failed to load your vendor pages.');
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }

  useEffect(() => { fetchMine(); }, [tenant]);

  function openCreate() {
    setEditingVendor(null);
    setShowVendorForm(true);
  }

  function openEdit(vendor: MyPopupVendor) {
    setEditingVendor(vendor);
    setShowVendorForm(true);
  }

  function closeVendorForm() {
    setShowVendorForm(false);
    setEditingVendor(null);
  }

  async function handleVendorSaved() {
    closeVendorForm();
    await fetchMine();
  }

  if (!user) {
    return (
      <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
        <div style={{ marginBottom: 8 }}>
          <Link to="/popups" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
            &larr; Back to Pop-Ups
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
        <Link to="/popups" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Pop-Ups
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Truck size={22} style={{ color: 'var(--amber)' }} /> My Schedule
      </h1>
      <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Manage your vendor page and post where you'll be.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      {loading ? (
        <div style={{ paddingTop: 32, textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          {showVendorForm && (
            <VendorForm
              key={editingVendor ? editingVendor.id : 'new'}
              tenantId={tenant!.id}
              editingVendor={editingVendor}
              onCancel={closeVendorForm}
              onSaved={handleVendorSaved}
            />
          )}

          {!showVendorForm && vendors.length === 0 && (
            <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
              <Truck size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
              <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
                Take your business on the road?
              </p>
              <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
                Set up your vendor page once - your name, what you are, a photo. Then every stop takes seconds to post, and fans always know where to find you.
              </p>
              <button className="btn btn-amber btn-sm" onClick={openCreate}>
                Set up my vendor page
              </button>
            </div>
          )}

          {!showVendorForm && vendors.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <button className="btn btn-secondary btn-sm" style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={openCreate}>
                  <Plus size={14} /> Add another vendor page
                </button>
              </div>
              {vendors.map(vendor => (
                <VendorCard key={vendor.id} vendor={vendor} tenantId={tenant!.id} onRefetch={fetchMine} onEdit={openEdit} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
