import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  listMyPetPosts, createPetPost, updatePetPost, resolvePetPost, renewPetPost, deletePetPost, uploadPetPhoto,
  speciesLabel, PET_SPECIES, REGION_CENTER, REGION_BOUNDS,
  type MyPetPost, type PetInput,
} from '../api/pets';
import { PawPrint, Pencil, Trash2, Camera, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Alert } from '../components/ui/Alert';
import { RegionMap } from 'kk-shared-ui/map';
import { resizeForUpload } from 'kk-shared-ui';

// Home Safe's authenticated "My Posts" page. Follows SalesMine.tsx's visual
// conventions exactly (serif header + amber icon, white .card rows with a
// green left accent, Spinner, Alert for guard errors - never toasts). Diff:
// type is fixed at create (two entry buttons instead of one "Post my X"),
// no schedule editor (a seen_date field instead), and a contact section with
// the masked-by-default checkbox plus a reveal log per post.

const NAME_MAX = 40;
const BODY_MAX = 500;
const HINT_MAX = 120;
const PHONE_MAX = 25;
const EMAIL_MAX = 120;

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
// Photo picker - same pattern as SalesMine.tsx's PhotoField.
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
      const res = await uploadPetPhoto(tenantId, optimized);
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
      <label style={labelStyle}>Photo</label>
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
      <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
        A photo does more than everything else combined - add one if you can.
      </p>
      {warning && <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--error)' }}>{warning}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Post form - create + edit, one component. Type is fixed for the life of
// the form (immutable server-side once created).
// ─────────────────────────────────────────────────────────────────────────────

interface PetFormProps {
  tenantId: string;
  editingPost: MyPetPost | null;
  type: 'lost' | 'found';
  homeLocation: { lat: number; lon: number } | null;
  onCancel: () => void;
  onSaved: () => void;
}

function PetForm({ tenantId, editingPost, type, homeLocation, onCancel, onSaved }: PetFormProps) {
  const initialCenter = useMemo(() => {
    if (editingPost) return { lat: editingPost.lat, lon: editingPost.lon };
    return homeLocation ?? REGION_CENTER;
  }, [editingPost, homeLocation]);

  const [species, setSpecies] = useState(editingPost?.species ?? '');
  const [petName, setPetName] = useState(editingPost?.pet_name ?? '');
  const [body, setBody] = useState(editingPost?.body ?? '');
  const [locationHint, setLocationHint] = useState(editingPost?.location_hint ?? '');
  const [seenDate, setSeenDate] = useState(editingPost?.seen_date ?? '');
  const [phone, setPhone] = useState(editingPost?.phone ?? '');
  const [email, setEmail] = useState(editingPost?.email ?? '');
  const [contactPublic, setContactPublic] = useState(editingPost?.contact_public ?? false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(editingPost?.photo_url ?? null);
  const [picked, setPicked] = useState(initialCenter);
  const [formError, setFormError] = useState('');
  const [working, setWorking] = useState(false);

  const today = todayDateStr();
  const minSeenDate = addDaysToDateStr(today, -60);

  const canSave = !!species && !!body.trim() && (!!phone.trim() || !!email.trim());

  async function handleSubmit() {
    if (working || !canSave) return;
    setWorking(true);
    setFormError('');
    try {
      const input: PetInput = {
        type,
        species,
        pet_name: petName.trim() || null,
        body: body.trim(),
        lat: picked.lat,
        lon: picked.lon,
        location_hint: locationHint.trim() || null,
        seen_date: seenDate || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        contact_public: contactPublic,
        photo_url: photoUrl,
      };
      if (editingPost) {
        await updatePetPost(tenantId, editingPost.id, input);
      } else {
        await createPetPost(tenantId, input);
      }
      onSaved();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save your post.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        {editingPost ? 'Edit Post' : type === 'lost' ? 'Report a Lost Pet' : 'Report a Found Pet'}
      </h3>
      {!editingPost && (
        <p style={{ margin: '0 0 16px', fontSize: '0.78rem', color: 'var(--muted)' }}>
          Pick the one that fits - a post can't switch later.
        </p>
      )}

      {formError && <Alert type="error" style={{ marginBottom: 12 }}>{formError}</Alert>}

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Species</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PET_SPECIES.map(s => (
            <button key={s.key} type="button"
              className={`btn btn-sm ${species === s.key ? 'btn-amber' : 'btn-secondary'}`}
              style={{ minHeight: 36 }}
              onClick={() => setSpecies(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Pet's name (optional)</label>
        <input className="form-input" style={inputStyle} maxLength={NAME_MAX} value={petName}
          placeholder="e.g. Copper"
          onChange={e => setPetName(e.target.value)} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Describe them</label>
        <textarea className="form-input" rows={4} maxLength={BODY_MAX} value={body}
          placeholder={type === 'lost'
            ? "Describe them like you'd tell a neighbor. Example: Brown beagle mix, red collar, answers to Copper. Skittish - don't chase, just call us."
            : 'Example: Young gray cat, no collar, very friendly. Safe in our garage on County Road 200 N.'}
          style={{ margin: 0, resize: 'vertical' }}
          onChange={e => setBody(e.target.value)} />
        <p style={{ margin: '4px 0 0', fontSize: '0.7rem', color: 'var(--muted)', textAlign: 'right' }}>{body.length}/{BODY_MAX}</p>
      </div>

      <PhotoField tenantId={tenantId} value={photoUrl} onChange={setPhotoUrl} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>{type === 'lost' ? 'When did they go missing?' : 'When did you find them?'}</label>
          <input type="date" className="form-input" style={inputStyle}
            min={minSeenDate} max={today} value={seenDate ?? ''}
            onChange={e => setSeenDate(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Nearby landmark (optional)</label>
          <input className="form-input" style={inputStyle} maxLength={HINT_MAX} value={locationHint ?? ''}
            placeholder="e.g. Near the County Road 200 N bridge"
            onChange={e => setLocationHint(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 8 }}>
        <div>
          <label style={labelStyle}>Phone</label>
          <input className="form-input" style={inputStyle} maxLength={PHONE_MAX} value={phone ?? ''}
            placeholder="e.g. 260-555-0110"
            onChange={e => setPhone(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input type="email" className="form-input" style={inputStyle} maxLength={EMAIL_MAX} value={email ?? ''}
            placeholder="e.g. you@example.com"
            onChange={e => setEmail(e.target.value)} />
        </div>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--muted)' }}>
        Your contact info is NOT shown on the post. When a neighbor wants to reach you, they sign in
        and ask - you see their name, they see your number. Nobody else does.
      </p>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
        <input type="checkbox" checked={contactPublic} onChange={e => setContactPublic(e.target.checked)}
          style={{ marginTop: 3 }} />
        <span>
          <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
            Show my contact right on the post
          </span>
          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--muted)' }}>
            Fastest way to get calls - but it's out there for anyone to see. Your choice.
          </span>
        </span>
      </label>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>{type === 'lost' ? 'Where they were last seen' : 'Where you found them'}</label>
        <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--muted)' }}>
          {type === 'lost'
            ? 'Drag the pin to where they were last seen - your best guess is plenty.'
            : 'Drag the pin to about where you found them.'}
        </p>
        <RegionMap
          pickable
          picked={picked}
          onPick={(lat, lon) => setPicked({ lat, lon })}
          center={picked}
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
          {working ? 'Saving...' : editingPost ? 'Save Changes' : 'Post it'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reveal log - a calm collapsed line expanding to name + relative time rows.
// ─────────────────────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function RevealLog({ post }: { post: MyPetPost }) {
  const [open, setOpen] = useState(false);
  if (post.reveal_count === 0) return null;

  return (
    <div style={{ marginBottom: 10 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
          padding: 0, cursor: 'pointer', fontSize: '0.8rem', color: 'var(--muted)',
        }}>
        {post.reveal_count} neighbor{post.reveal_count === 1 ? '' : 's'} asked for your contact info
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {post.reveals.map((r, i) => (
            <div key={i} style={{ fontSize: '0.78rem', color: 'var(--text)' }}>
              {r.display_name} · {relativeTime(r.created_at)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A single post card
// ─────────────────────────────────────────────────────────────────────────────

function PetCard({ post, tenantId, onRefetch, onEdit }: {
  post: MyPetPost;
  tenantId: string;
  onRefetch: () => void;
  onEdit: (post: MyPetPost) => void;
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
    if (!window.confirm("Take this post down? If they're home, use Home safe instead - it lets everyone who shared it see the good ending.")) return;
    run(() => deletePetPost(tenantId, post.id));
  }

  const title = post.pet_name || speciesLabel(post.species);

  return (
    <div className="card" style={{ background: 'var(--white)', padding: 16, marginBottom: 16, borderLeft: '4px solid var(--green)' }}>
      <div style={{ display: 'flex', gap: 12 }}>
        {post.photo_url && (
          <img src={post.photo_url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
            <span style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--green)' }}>{title}</span>
            <span style={{
              fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
              borderRadius: 'var(--r-sm)',
              background: post.type === 'lost' ? 'rgba(200,134,10,0.14)' : 'rgba(80,120,80,0.12)',
              color: post.type === 'lost' ? 'var(--amber)' : 'var(--green)',
            }}>
              {post.type === 'lost' ? 'Lost' : 'Found'}
            </span>
          </div>

          {post.state === 'hidden_by_admin' ? (
            <Alert type="error" style={{ marginBottom: 10 }}>{post.state_note}</Alert>
          ) : (
            <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: post.state === 'archived' ? 'var(--amber)' : 'var(--sage)' }}>
              {post.state_note}
            </p>
          )}
        </div>
      </div>

      <RevealLog post={post} />

      {error && <Alert type="error" style={{ marginBottom: 10 }}>{error}</Alert>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {post.state === 'looking' && (
          <>
            <button className="btn btn-primary btn-sm" disabled={working} style={{ minHeight: 32 }}
              onClick={() => run(() => resolvePetPost(tenantId, post.id))}>
              Home safe
            </button>
            <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
              onClick={() => run(() => renewPetPost(tenantId, post.id))}>
              Still looking
            </button>
            <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={() => onEdit(post)}>
              <Pencil size={13} /> Edit
            </button>
            <button className="btn btn-secondary btn-sm" disabled={working}
              style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={handleRemove}>
              <Trash2 size={13} /> Remove
            </button>
          </>
        )}
        {post.state === 'archived' && (
          <>
            <button className="btn btn-primary btn-sm" disabled={working} style={{ minHeight: 32 }}
              onClick={() => run(() => resolvePetPost(tenantId, post.id))}>
              Home safe
            </button>
            <button className="btn btn-amber btn-sm" disabled={working} style={{ minHeight: 32 }}
              onClick={() => run(() => renewPetPost(tenantId, post.id))}>
              Still looking
            </button>
            <button className="btn btn-secondary btn-sm" disabled={working}
              style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={handleRemove}>
              <Trash2 size={13} /> Remove
            </button>
          </>
        )}
        {post.state === 'hidden_by_admin' && (
          <button className="btn btn-secondary btn-sm" disabled={working}
            style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={handleRemove}>
            <Trash2 size={13} /> Remove
          </button>
        )}
        {/* home_safe: no actions - the happy history */}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function PetsMine() {
  const { user } = useAuth();
  const { tenant } = useTenant();

  const [posts, setPosts] = useState<MyPetPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formType, setFormType] = useState<'lost' | 'found' | null>(null);
  const [editingPost, setEditingPost] = useState<MyPetPost | null>(null);

  const hasLoadedOnce = useRef(false);

  async function fetchMine() {
    if (!tenant) return;
    if (!hasLoadedOnce.current) setLoading(true);
    setError('');
    try {
      const res = await listMyPetPosts(tenant.id);
      setPosts(res.data.posts || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load your posts.');
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }

  useEffect(() => { fetchMine(); }, [tenant]);

  function openCreate(type: 'lost' | 'found') {
    setEditingPost(null);
    setFormType(type);
  }

  function openEdit(post: MyPetPost) {
    setEditingPost(post);
    setFormType(post.type);
  }

  function closeForm() {
    setFormType(null);
    setEditingPost(null);
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
          <Link to="/pets" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
            &larr; Back to Home Safe
          </Link>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ marginBottom: 16 }}>You are not signed in.</p>
          <a className="btn btn-primary" href="/auth/login">Sign In</a>
        </div>
      </div>
    );
  }

  const showForm = formType !== null;

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ marginBottom: 8 }}>
        <Link to="/pets" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Home Safe
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <PawPrint size={22} style={{ color: 'var(--amber)' }} /> Home Safe
      </h1>
      <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Manage your posts and mark them Home safe when they come home.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      {loading ? (
        <div style={{ paddingTop: 32, textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          {showForm && (
            <PetForm
              key={editingPost ? editingPost.id : `new-${formType}`}
              tenantId={tenant!.id}
              editingPost={editingPost}
              type={formType!}
              homeLocation={homeLocation}
              onCancel={closeForm}
              onSaved={handleSaved}
            />
          )}

          {!showForm && posts.length === 0 && (
            <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
              <PawPrint size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
              <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>
                Nobody wants to need this page.
              </p>
              <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
                When a pet goes missing - yours or one that wandered into your yard - post it here in a minute.
                The whole region can see it, and the link travels anywhere you share it.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-amber btn-sm" onClick={() => openCreate('lost')}>Report a lost pet</button>
                <button className="btn btn-secondary btn-sm" onClick={() => openCreate('found')}>Report a found pet</button>
              </div>
              <p style={{ margin: '10px 0 0', fontSize: '0.74rem', color: 'var(--muted)' }}>
                Pick the one that fits - a post can't switch later.
              </p>
            </div>
          )}

          {!showForm && posts.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
                <button className="btn btn-amber btn-sm" style={{ minHeight: 34 }} onClick={() => openCreate('lost')}>
                  Report a lost pet
                </button>
                <button className="btn btn-secondary btn-sm" style={{ minHeight: 34 }} onClick={() => openCreate('found')}>
                  Report a found pet
                </button>
              </div>
              {posts.map(post => (
                <PetCard key={post.id} post={post} tenantId={tenant!.id} onRefetch={fetchMine} onEdit={openEdit} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
