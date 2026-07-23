import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  listMyFresh, createFreshStand, updateFreshStand, setFreshStandVisibility, deleteFreshStand,
  createFreshPost, updateFreshPost, setFreshPostSoldOut, relistFreshPost, deleteFreshPost,
  uploadFreshPhoto, categoryLabel, standLocation, FRESH_CATEGORIES, REGION_CENTER, REGION_BOUNDS,
  type MyFreshStand, type MyFreshPost, type FreshStandInput,
} from '../api/fresh';
import { geocodeAddress } from '../api/geocode';
import { Sprout, Pencil, Trash2, Plus, Pause, Play, Camera, X, MapPin, Info } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Alert } from '../components/ui/Alert';
import { RegionMap } from 'kk-shared-ui';

// Fresh Today's authenticated "My Stand" page. Follows FreshToday/FreshStand's
// visual conventions exactly (serif header + amber Sprout icon, white .card
// rows with a green left accent, Spinner, Alert for guard errors - never
// toasts, per the brief's global hard rule). Any signed-in local can run a
// stand here - no merchant verification, unlike the Business Hub.

const BODY_MAX = 280;
const NAME_MAX = 60;
const DESCRIPTION_MAX = 280;
const ADDRESS_HINT_MAX = 120;
const PHONE_MAX = 25;

const inputStyle = { minHeight: 40, margin: 0 } as const;
const labelStyle = { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 } as const;

const categoryPillStyle = {
  fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase' as const, padding: '2px 8px',
  borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
};

// Client-side warning only, over ~8 MB per the brief - never a hard block.
// image-api enforces the real cap server-side regardless of what the client
// does here.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Photo picker - shared by the stand form and the post composer below.
// Uploads immediately on file choice (rather than deferring to form submit)
// so the caller always holds a ready-to-send photo_url string, never a raw
// File - the create/update endpoints only ever take a URL. Photos are
// optional everywhere: an oversized file or a failed upload shows an inline
// warning and never blocks Save/Post - it just leaves photo_url as it was.
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
    e.target.value = ''; // allow choosing the same file again later
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
      const res = await uploadFreshPhoto(tenantId, file);
      onChange(res.data.url);
    } catch (err: any) {
      // Upload failed - the real value (whatever was already saved, or null)
      // never changed, so the preview must revert to match it exactly. Leaving
      // the failed blob showing would make the UI lie about what Save will
      // actually persist, and would let the remove button clear the wrong
      // thing (see PhotoField's file-level comment).
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
// Stand form - create + edit, same component (per the brief). Keyed by the
// caller on the target stand id (or 'new') so its internal state resets
// cleanly every time it's opened for a different stand.
// ─────────────────────────────────────────────────────────────────────────────

interface StandFormProps {
  tenantId: string;
  editingStand: MyFreshStand | null;
  homeLocation: { lat: number; lon: number } | null;
  onCancel: () => void;
  onSaved: () => void;
  createStand: (body: FreshStandInput) => ReturnType<typeof createFreshStand>;
  updateStand: (id: string, body: Partial<FreshStandInput>) => ReturnType<typeof updateFreshStand>;
}

function StandForm({ tenantId, editingStand, homeLocation, onCancel, onSaved, createStand, updateStand }: StandFormProps) {
  const initialCenter = useMemo(() => {
    if (editingStand) return { lat: editingStand.lat, lon: editingStand.lon };
    return homeLocation ?? REGION_CENTER;
  }, [editingStand, homeLocation]);

  const [name, setName] = useState(editingStand?.name ?? '');
  const [description, setDescription] = useState(editingStand?.description ?? '');
  const [addressHint, setAddressHint] = useState(editingStand?.address_hint ?? '');
  const [phone, setPhone] = useState(editingStand?.phone ?? '');
  const [categories, setCategories] = useState<string[]>(editingStand?.categories ?? []);
  const [photoUrl, setPhotoUrl] = useState<string | null>(editingStand?.photo_url ?? null);
  const [picked, setPicked] = useState(initialCenter);
  const [mapCenter, setMapCenter] = useState(initialCenter);
  const [categoryError, setCategoryError] = useState('');
  const [formError, setFormError] = useState('');
  const [working, setWorking] = useState(false);

  const [locating, setLocating] = useState(false);
  const [locatedMatch, setLocatedMatch] = useState('');
  const [locateError, setLocateError] = useState('');

  async function handleLocate() {
    const addr = (addressHint ?? '').trim();
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

  function toggleCategory(key: string) {
    setCategories(prev => {
      if (prev.includes(key)) {
        setCategoryError('');
        return prev.filter(k => k !== key);
      }
      if (prev.length >= 4) {
        setCategoryError('Pick up to four.');
        return prev;
      }
      setCategoryError('');
      return [...prev, key];
    });
  }

  async function handleSubmit() {
    if (working) return;
    setWorking(true);
    setFormError('');
    try {
      const body: FreshStandInput = {
        name: name.trim(),
        description: description.trim() || null,
        lat: picked.lat,
        lon: picked.lon,
        categories,
        address_hint: (addressHint ?? '').trim(),
        phone: phone.trim() || null,
        photo_url: photoUrl,
      };
      if (editingStand) {
        await updateStand(editingStand.id, body);
      } else {
        await createStand(body);
      }
      onSaved();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save your stand.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        {editingStand ? 'Edit Stand' : 'Set Up My Stand'}
      </h3>

      {formError && <Alert type="error" style={{ marginBottom: 12 }}>{formError}</Alert>}

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Stand name</label>
        <input className="form-input" style={inputStyle} maxLength={NAME_MAX} value={name}
          placeholder="e.g. Miller Family Farm"
          onChange={e => setName(e.target.value)} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Description (optional)</label>
        <textarea className="form-input" rows={2} maxLength={DESCRIPTION_MAX} value={description ?? ''}
          placeholder="A line or two about what you grow, bake, or make."
          style={{ margin: 0, resize: 'vertical' }}
          onChange={e => setDescription(e.target.value)} />
      </div>

      <PhotoField tenantId={tenantId} value={photoUrl} onChange={setPhotoUrl} />

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Categories</label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {FRESH_CATEGORIES.map(c => (
            <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={categories.includes(c.key)} onChange={() => toggleCategory(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
        {categoryError && (
          <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--error)' }}>{categoryError}</p>
        )}
      </div>

      {/* auto-fit + minmax collapses to a single column once the viewport is
          too narrow for two ~200px fields side by side (375px width), rather
          than squeezing both into cramped half-columns that clip their
          placeholders and wrap their labels awkwardly. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Address</label>
          <p style={{ margin: '0 0 6px', fontSize: '0.74rem', color: 'var(--muted)' }}>
            Street, city, and state at minimum - so we can place your pin correctly.
          </p>
          <input className="form-input" style={inputStyle} maxLength={ADDRESS_HINT_MAX} value={addressHint ?? ''}
            placeholder="e.g. 1255 N 170 W, Angola, IN"
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
        <label style={labelStyle}>Stand location</label>
        <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--muted)' }}>
          Type an address above and tap Locate to jump the pin there, then drag it the rest of the way to your stand.
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
          disabled={working || !name.trim() || categories.length === 0 || !(addressHint ?? '').trim()}
          style={{ minHeight: 40 }}>
          {working ? 'Saving...' : editingStand ? 'Save Changes' : 'Set up my stand'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A single owner post row (My Stand's posts list, latest 10 per stand).
// ─────────────────────────────────────────────────────────────────────────────

function PostRow({ post, tenantId, onChanged, onError }: {
  post: MyFreshPost;
  tenantId: string;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.body);
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

  if (editing) {
    return (
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
        <textarea className="form-input" rows={2} maxLength={BODY_MAX} value={editText}
          style={{ margin: 0, resize: 'vertical' }}
          onChange={e => setEditText(e.target.value)} />
        <p style={{ margin: '4px 0 8px', fontSize: '0.7rem', color: 'var(--muted)', textAlign: 'right' }}>
          {editText.length}/{BODY_MAX}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
            onClick={() => { setEditing(false); setEditText(post.body); }}>
            Cancel
          </button>
          <button className="btn btn-amber btn-sm" disabled={working || !editText.trim()} style={{ minHeight: 32 }}
            onClick={() => run(async () => {
              await updateFreshPost(tenantId, post.id, { body: editText.trim() });
              setEditing(false);
            })}>
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <p style={{ margin: '0 0 6px', fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.4 }}>{post.body}</p>
      {post.photo_url && (
        <img src={post.photo_url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, marginBottom: 8, display: 'block' }} />
      )}
      {post.state === 'hidden_by_admin' ? (
        <Alert type="error" style={{ marginBottom: 8 }}>{post.state_note}</Alert>
      ) : (
        <p style={{ margin: '0 0 8px', fontSize: '0.76rem', color: 'var(--muted)' }}>{post.state_note}</p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {post.state === 'live' && (
          <>
            <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
              onClick={() => run(() => setFreshPostSoldOut(tenantId, post.id))}>
              Sold out
            </button>
            <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={() => setEditing(true)}>
              <Pencil size={13} /> Edit
            </button>
            <button className="btn btn-secondary btn-sm" disabled={working}
              style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={() => run(() => deleteFreshPost(tenantId, post.id))}>
              <Trash2 size={13} /> Remove
            </button>
          </>
        )}
        {post.state === 'sold_out' && (
          <>
            <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={() => setEditing(true)}>
              <Pencil size={13} /> Edit
            </button>
            <button className="btn btn-secondary btn-sm" disabled={working}
              style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={() => run(() => deleteFreshPost(tenantId, post.id))}>
              <Trash2 size={13} /> Remove
            </button>
          </>
        )}
        {post.can_relist && (
          <button className="btn btn-amber btn-sm" disabled={working} style={{ minHeight: 32 }}
            onClick={() => run(() => relistFreshPost(tenantId, post.id))}>
            Out again today
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A single stand card: state note, Pause/Show + Edit + Remove, the post
// composer (for any stand the owner can still act on), and its post rows.
// ─────────────────────────────────────────────────────────────────────────────

function StandCard({ stand, tenantId, onRefetch, onEdit }: {
  stand: MyFreshStand;
  tenantId: string;
  onRefetch: () => void;
  onEdit: (stand: MyFreshStand) => void;
}) {
  const [composerText, setComposerText] = useState('');
  const [composerPhotoUrl, setComposerPhotoUrl] = useState<string | null>(null);
  // Bumped after every successful post so the composer's PhotoField (keyed on
  // this below) fully remounts - PhotoField tracks its own localPreview blob
  // internally and has no way to know composerPhotoUrl was reset to null out
  // from under it otherwise, which would leave the just-posted photo's
  // preview showing under an empty composer as if it were still attached.
  const [composerResetKey, setComposerResetKey] = useState(0);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  async function run(action: () => Promise<unknown>, onOk?: () => void) {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      await action();
      onOk?.();
      onRefetch();
    } catch (err: any) {
      setError(err.message || 'That action failed.');
    } finally {
      setWorking(false);
    }
  }

  function handleRemoveStand() {
    if (!window.confirm("Remove this stand? Its posts go with it. This can't be undone from here.")) return;
    run(() => deleteFreshStand(tenantId, stand.id));
  }

  function handlePost() {
    const body = composerText.trim();
    if (!body) return;
    run(
      () => createFreshPost(tenantId, stand.id, { body, photo_url: composerPhotoUrl }),
      () => { setComposerText(''); setComposerPhotoUrl(null); setComposerResetKey(k => k + 1); }
    );
  }

  const canManage = stand.state !== 'hidden_by_admin';

  return (
    <div className="card" style={{ background: 'var(--white)', padding: 16, marginBottom: 16, borderLeft: '4px solid var(--green)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
        <span style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--green)' }}>{stand.name}</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {stand.categories.map(cat => (
            <span key={cat} style={categoryPillStyle}>{categoryLabel(cat)}</span>
          ))}
        </div>
      </div>

      {/* Shows what neighbors see as the primary location label on the public
          board. Null (lookup hasn't run yet, or nothing within 50 miles) is
          rendered as nothing here - never "null, null" or a broken string. */}
      {standLocation(stand.nearest_city, stand.nearest_state) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)' }}>
          <MapPin size={12} style={{ color: 'var(--amber)' }} />
          {standLocation(stand.nearest_city, stand.nearest_state)}
        </div>
      )}

      {stand.photo_url && (
        <img src={stand.photo_url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, marginBottom: 10, display: 'block' }} />
      )}

      {stand.state === 'hidden_by_admin' ? (
        <Alert type="error" style={{ marginBottom: 10 }}>{stand.state_note}</Alert>
      ) : (
        <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: stand.state === 'paused' ? 'var(--amber)' : 'var(--sage)' }}>
          {stand.state_note}
        </p>
      )}

      {error && <Alert type="error" style={{ marginBottom: 10 }}>{error}</Alert>}

      {canManage && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button className="btn btn-secondary btn-sm" disabled={working}
            style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={() => run(() => setFreshStandVisibility(tenantId, stand.id, stand.state !== 'paused'))}>
            {stand.state === 'paused' ? <><Play size={13} /> Show</> : <><Pause size={13} /> Pause</>}
          </button>
          <button className="btn btn-secondary btn-sm" disabled={working}
            style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={() => onEdit(stand)}>
            <Pencil size={13} /> Edit
          </button>
          <button className="btn btn-secondary btn-sm" disabled={working}
            style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={handleRemoveStand}>
            <Trash2 size={13} /> Remove
          </button>
        </div>
      )}
      {!canManage && (
        <div style={{ marginBottom: 14 }}>
          <button className="btn btn-secondary btn-sm" disabled={working}
            style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={handleRemoveStand}>
            <Trash2 size={13} /> Remove
          </button>
        </div>
      )}

      {canManage && (
        <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
          <textarea className="form-input" rows={2} maxLength={BODY_MAX} value={composerText}
            placeholder="What's out today? Example: Sweet corn just picked, 40 dozen, $6/dozen. Cash box."
            style={{ margin: 0, resize: 'vertical' }}
            onChange={e => setComposerText(e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, marginBottom: 10 }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{composerText.length}/{BODY_MAX}</span>
          </div>
          <PhotoField key={composerResetKey} tenantId={tenantId} value={composerPhotoUrl} onChange={setComposerPhotoUrl} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-amber btn-sm" disabled={working || !composerText.trim()} style={{ minHeight: 34 }}
              onClick={handlePost}>
              Post it
            </button>
          </div>
        </div>
      )}

      {stand.posts.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>Nothing posted here yet.</p>
      ) : (
        <div>
          {stand.posts.map(post => (
            <PostRow key={post.id} post={post} tenantId={tenantId} onChanged={onRefetch} onError={setError} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function FreshMine() {
  const { user } = useAuth();
  const { tenant } = useTenant();

  const [stands, setStands] = useState<MyFreshStand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingStand, setEditingStand] = useState<MyFreshStand | null>(null);

  // Only the very first load shows the full-page Spinner. Every later
  // refetch (after posting, pausing, editing, etc.) happens quietly in the
  // background - collapsing the whole page to a centered spinner on every
  // single mutation would blow away scroll position and the other stand
  // cards' in-progress state (a half-typed composer on a different stand)
  // for no reason, since the data is already on screen and correct.
  const hasLoadedOnce = useRef(false);

  async function fetchMine() {
    if (!tenant) return;
    if (!hasLoadedOnce.current) setLoading(true);
    setError('');
    try {
      const res = await listMyFresh(tenant.id);
      // A deleted stand's state is 'removed' but the row still comes back
      // from GET /fresh/mine forever (src/handlers/fresh.ts's query has no
      // deleted_at filter) - per the brief's own copy table, a removed stand
      // is "not shown," so it's filtered out of the rendered list here rather
      // than displayed with a "Removed." note the way posts are.
      setStands((res.data.stands || []).filter(s => s.state !== 'removed'));
    } catch (err: any) {
      setError(err.message || 'Failed to load your stand.');
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }

  useEffect(() => { fetchMine(); }, [tenant]);

  function openCreate() {
    setEditingStand(null);
    setShowForm(true);
  }

  function openEdit(stand: MyFreshStand) {
    setEditingStand(stand);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingStand(null);
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
          <Link to="/fresh" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
            &larr; Back to Fresh Today
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
        <Link to="/fresh" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Fresh Today
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sprout size={22} style={{ color: 'var(--amber)' }} /> My Stand
      </h1>
      <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Manage your stand and post what's out today.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      {loading ? (
        <div style={{ paddingTop: 32, textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          {showForm && (
            <StandForm
              key={editingStand ? editingStand.id : 'new'}
              tenantId={tenant!.id}
              editingStand={editingStand}
              homeLocation={homeLocation}
              onCancel={closeForm}
              onSaved={handleSaved}
              createStand={body => createFreshStand(tenant!.id, body)}
              updateStand={(id, body) => updateFreshStand(tenant!.id, id, body)}
            />
          )}

          {!showForm && stands.length === 0 && (
            <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
              <Sprout size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
              <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
                Sell what you grow, bake, or make.
              </p>
              <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
                Your stand takes about a minute to set up. Neighbors see it the moment you post.
              </p>
              <button className="btn btn-amber btn-sm" onClick={openCreate}>
                Set up my stand
              </button>
            </div>
          )}

          {!showForm && stands.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <button className="btn btn-secondary btn-sm" style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={openCreate}>
                  <Plus size={14} /> Add another stand
                </button>
              </div>
              {stands.map(stand => (
                <StandCard key={stand.id} stand={stand} tenantId={tenant!.id} onRefetch={fetchMine} onEdit={openEdit} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
