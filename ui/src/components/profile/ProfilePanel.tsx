import { useState, useEffect, useRef, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Drawer } from 'kk-shared-ui';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { getMe } from '../../api/auth';
import { updateProfile, uploadAvatar, updateLocation } from '../../api/profile';
import { Alert } from '../ui/Alert';
import { Spinner } from '../ui/Spinner';

async function resizeToWebP(file: File, maxSize = 400): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        b => b ? resolve(b) : reject(new Error('Image conversion failed')),
        'image/webp', 0.85
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
  });
}

function AvatarWidget({
  name, avatarUrl, uploading, onFileSelected,
}: {
  name: string;
  avatarUrl: string | null;
  uploading: boolean;
  onFileSelected: (f: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const parts   = name.trim().split(' ');
  const letters = (parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : name.slice(0, 2)
  ).toUpperCase();

  return (
    <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: avatarUrl ? 'transparent' : 'var(--green)',
        color: 'var(--cream)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.6rem', fontWeight: 'bold',
        overflow: 'hidden', position: 'relative',
      }}>
        {avatarUrl
          ? <img src={avatarUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : letters
        }
        {uploading && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(30,51,32,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
          }}>
            <Spinner size="sm" />
          </div>
        )}
      </div>

      {!uploading && (
        <button
          type="button"
          aria-label="Change profile photo"
          onClick={() => fileRef.current?.click()}
          style={{
            position: 'absolute', bottom: 0, right: 0,
            width: 28, height: 28, borderRadius: '50%',
            background: 'var(--amber)', border: '2px solid var(--cream)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0,
          }}
        >
          <Camera size={13} color="white" />
        </button>
      )}

      <input
        ref={fileRef} type="file" accept="image/*"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFileSelected(f); e.target.value = ''; }}
      />
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const DISTANCE_OPTIONS = [10, 25, 50, 100];

export default function ProfilePanel({ open, onClose, onSaved }: Props) {
  const { user, updateUser } = useAuth();
  const { tenant } = useTenant();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    display_name: '', location: '', bio: '',
    home_zip_location: '', home_distance_preference: 25,
  });
  const [saveError, setSaveError]     = useState('');
  const [saved, setSaved]             = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [isFetching, setIsFetching]   = useState(false);

  useEffect(() => {
    if (!open || !user || !tenant) return;
    setSaveError('');
    setSaved(false);
    setAvatarError('');
    setIsFetching(true);
    getMe(tenant.id)
      .then(fresh => {
        updateUser(fresh);
        setForm({
          display_name:            fresh.display_name || '',
          location:                fresh.location     || '',
          bio:                     (fresh as any).bio || '',
          home_zip_location:       fresh.home_zip_location       ?? '',
          home_distance_preference: fresh.home_distance_preference ?? 25,
        });
      })
      .catch(() => {
        setForm({
          display_name:            user.display_name || '',
          location:                user.location     || '',
          bio:                     (user as any).bio || '',
          home_zip_location:       user.home_zip_location       ?? '',
          home_distance_preference: user.home_distance_preference ?? 25,
        });
      })
      .finally(() => setIsFetching(false));
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: (updates: Parameters<typeof updateProfile>[1]) =>
      updateProfile(tenant!.id, updates),
  });

  const locationMutation = useMutation({
    mutationFn: updateLocation,
  });

  const avatarMutation = useMutation({
    mutationFn: ({ tenantId, blob }: { tenantId: string; blob: Blob }) =>
      uploadAvatar(tenantId, blob),
    onSuccess: (res) => {
      const url = res.data.avatar_url;
      if (url) { updateUser({ avatar_url: url }); qc.invalidateQueries({ queryKey: ['me'] }); }
      setAvatarError('');
    },
    onError: (e: any) => setAvatarError(e.message || 'Photo upload failed.'),
  });

  const handleAvatarFile = useCallback(async (file: File) => {
    if (!tenant) return;
    try {
      const blob = await resizeToWebP(file);
      avatarMutation.mutate({ tenantId: tenant.id, blob });
    } catch (e: any) {
      setAvatarError(e.message || 'Could not process image.');
    }
  }, [tenant, avatarMutation]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError('');

    const zip = form.home_zip_location.trim();
    if (zip && !/^\d{5}$/.test(zip)) {
      setSaveError('Please enter a valid 5-digit zip code.');
      return;
    }

    try {
      const profileRes = await saveMutation.mutateAsync({
        display_name: form.display_name.trim() || undefined,
        location:     form.location.trim()     || undefined,
        bio:          form.bio.trim()          || undefined,
      });
      updateUser(profileRes.data.user);
    } catch (e: any) {
      setSaveError(e.message || 'Could not save changes.');
      return;
    }

    const currentZip  = user?.home_zip_location       ?? '';
    const currentDist = user?.home_distance_preference ?? 25;
    if (zip !== currentZip || (zip && form.home_distance_preference !== currentDist)) {
      try {
        const locRes = await locationMutation.mutateAsync({
          home_zip_location:        zip || null,
          home_distance_preference: zip ? form.home_distance_preference : null,
        });
        updateUser({
          home_zip_location:        locRes.data.profile.home_zip_location,
          home_zip_lat:             locRes.data.profile.home_zip_lat,
          home_zip_lon:             locRes.data.profile.home_zip_lon,
          home_distance_preference: locRes.data.profile.home_distance_preference,
        });
      } catch {
        // The name/location/bio save above already landed - only the zip
        // update failed, so say exactly that instead of a blanket failure.
        qc.invalidateQueries({ queryKey: ['me'] });
        setSaveError('Your profile was saved. The zip code could not be updated - try again.');
        return;
      }
    }

    qc.invalidateQueries({ queryKey: ['me'] });
    setSaved(true);
    setTimeout(() => {
      onSaved?.();
    }, 800);
  }

  const isPending = saveMutation.isPending || locationMutation.isPending || isFetching;
  const avatarUrl = user?.avatar_url ?? null;
  const name      = user?.display_name || user?.email || 'Me';

  return (
    <Drawer open={open} onClose={onClose} side="right" ariaLabel="Edit profile">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--green)', width: 44, height: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 'var(--r-sm)', flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <h2 data-drawer-heading style={{ fontFamily: 'var(--font-serif)', fontSize: '1.15rem', fontWeight: 'bold', color: 'var(--green)', margin: 0 }}>
            Edit Profile
          </h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <AvatarWidget
            name={name}
            avatarUrl={avatarUrl}
            uploading={avatarMutation.isPending}
            onFileSelected={handleAvatarFile}
          />
          {avatarError && (
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.8rem', color: 'var(--error)', textAlign: 'center' }}>
              {avatarError}
            </span>
          )}
        </div>

        {saved     && <Alert type="success" style={{ marginBottom: 16 }}>Profile saved.</Alert>}
        {saveError && <Alert type="error"   style={{ marginBottom: 16 }}>{saveError}</Alert>}

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label className="form-label">
              Display Name <span style={{ color: 'var(--error)' }}>*</span>
            </label>
            <input
              className="form-input"
              value={form.display_name}
              maxLength={50}
              required
              onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Location</label>
            <input
              className="form-input"
              placeholder="e.g. Angola, IN"
              value={form.location}
              maxLength={100}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Bio</label>
            <textarea
              className="form-textarea"
              placeholder="Tell other members about yourself…"
              value={form.bio}
              maxLength={300}
              rows={3}
              onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
            />
            <p className="form-hint">{form.bio.length} / 300</p>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0 16px' }} />

          <div className="form-group">
            <label className="form-label">Home Zip Code</label>
            <input
              className="form-input"
              placeholder="e.g. 46703"
              value={form.home_zip_location}
              maxLength={5}
              inputMode="numeric"
              onChange={e => setForm(f => ({ ...f, home_zip_location: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
            />
            <p className="form-hint">Used to show what's near you across all Lake &amp; Locals apps. Leave blank to see everything.</p>
          </div>

          {form.home_zip_location.length === 5 && (
            <div className="form-group">
              <label className="form-label">Search Distance</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {DISTANCE_OPTIONS.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, home_distance_preference: d }))}
                    style={{
                      flex: 1, padding: '8px 0', border: '1px solid',
                      borderRadius: 'var(--r-sm)', cursor: 'pointer',
                      fontFamily: 'var(--font-sans)', fontSize: '0.85rem', fontWeight: 600,
                      transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                      background: form.home_distance_preference === d ? 'var(--green)' : 'var(--white)',
                      color:      form.home_distance_preference === d ? 'var(--cream)' : 'var(--muted)',
                      borderColor: form.home_distance_preference === d ? 'var(--green)' : 'var(--border)',
                    }}
                  >
                    {d} mi
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            style={{ marginBottom: 8 }}
            disabled={isPending || saved}
          >
            {isPending ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
          </button>
        </form>

        <button
          onClick={() => {
            onClose();
            navigate('/profile');
          }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            marginTop: 8, padding: '13px 20px', width: '100%',
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
            fontFamily: 'var(--font-sans)', fontSize: '0.9rem', fontWeight: 600,
            color: 'var(--green)',
            background: 'var(--white)', cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--sage)';
            (e.currentTarget as HTMLButtonElement).style.background  = 'var(--cream)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
            (e.currentTarget as HTMLButtonElement).style.background  = 'var(--white)';
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          Account Details
        </button>
    </Drawer>
  );
}
