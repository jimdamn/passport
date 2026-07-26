import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  getSplashEligible, getMySplash, submitSplash, updateSplashCaption, withdrawSplash,
  getSplashMediaViewUrl, type SplashEligibleBusiness, type SplashSubmission, type SplashTombstone,
} from '../api/splash';
import { Camera, Pencil, Trash2 } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { Alert } from '../components/ui/Alert';
import { resizeForUpload } from 'kk-shared-ui';

// Social Splash's My Splash page - the only surface this feature has (there
// is no public board; content is never shown on-platform). Follows Fresh
// Today's "My Stand" visual conventions (FreshMine.tsx): serif header + amber
// icon, white .card rows with a green left accent, Spinner, Alert for guard
// errors - never toasts.

const CAPTION_MAX = 280;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // client-side warning only; image-api enforces the real cap

const labelStyle = { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 } as const;

function statusColor(tone: 'muted' | 'amber' | 'sage' | 'error'): string {
  switch (tone) {
    case 'amber': return 'var(--amber)';
    case 'sage': return 'var(--sage)';
    case 'error': return 'var(--error)';
    default: return 'var(--muted)';
  }
}

function shortDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Plain-language status line per submission, per the content-lifecycle
 * "owner status transparency" rule - every hidden/declined/removed state
 * renders in plain language, with the destruction date and (for admin
 * removals) the stored reason. Nothing here is computed server-side; all the
 * raw fields needed are already on the row.
 */
function statusLine(sub: SplashSubmission): { text: string; tone: 'muted' | 'amber' | 'sage' | 'error' } {
  if (sub.status === 'submitted') {
    return { text: 'Waiting for the business to respond.', tone: 'muted' };
  }
  if (sub.status === 'held') {
    const by = sub.hold_expires_at ? ` - they have until ${shortDate(sub.hold_expires_at)} to decide` : '';
    return { text: `Accepted! The business is deciding whether to license it${by}.`, tone: 'amber' };
  }
  if (sub.status === 'licensed') {
    return { text: 'Licensed - thanks for sharing this with them.', tone: 'sage' };
  }
  if (sub.status === 'declined') {
    const by = sub.destroy_after ? ` It will be permanently deleted around ${shortDate(sub.destroy_after)}.` : '';
    return { text: `Declined.${by}`, tone: 'muted' };
  }
  // 'removed' covers both a self-withdraw and an admin removal - the stored
  // reason is what tells them apart (never owner-overridable either way).
  const by = sub.destroy_after ? ` It will be permanently deleted around ${shortDate(sub.destroy_after)}.` : '';
  if (sub.admin_removed_reason) {
    return { text: `Removed by an admin: ${sub.admin_removed_reason}${by}`, tone: 'error' };
  }
  return { text: `Withdrawn.${by}`, tone: 'muted' };
}

// ─────────────────────────────────────────────────────────────────────────────
// A submission's photo, loaded through a fresh short-TTL signed view URL -
// raw image-api keys never reach the client. Failure is quiet: a photo
// preview is a nice-to-have, never something that should block the row.
// ─────────────────────────────────────────────────────────────────────────────

function SplashPhoto({ tenantId, submissionId }: { tenantId: string; submissionId: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setFailed(false);
    getSplashMediaViewUrl(tenantId, submissionId)
      .then(res => { if (active) setUrl(res.data.url); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [tenantId, submissionId]);

  if (failed) return null;
  if (!url) {
    return <div style={{ width: 80, height: 80, borderRadius: 8, background: 'var(--light)', flexShrink: 0 }} />;
  }
  return <img src={url} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, display: 'block', flexShrink: 0 }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Submit form - one eligible business at a time.
// ─────────────────────────────────────────────────────────────────────────────

function SubmitForm({ tenantId, business, onCancel, onSubmitted }: {
  tenantId: string;
  business: SplashEligibleBusiness;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    if (f.size > MAX_PHOTO_BYTES) {
      setError('That photo is over 8 MB - most phone photos are smaller. Try another one.');
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  }

  async function handleSubmit() {
    if (!file || working) return;
    setWorking(true);
    setError('');
    try {
      const optimized = await resizeForUpload(file);
      await submitSplash(tenantId, business.business_id, optimized, caption);
      onSubmitted();
    } catch (err: any) {
      setError(err.message || 'That photo could not be shared. Try again.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        Share a photo with {business.business_name}
      </h3>
      {business.blurb && (
        <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>{business.blurb}</p>
      )}

      {error && <Alert type="error" style={{ marginBottom: 12 }}>{error}</Alert>}

      <div style={{ marginBottom: 12 }}>
        {previewUrl && (
          <img src={previewUrl} alt="" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, display: 'block', marginBottom: 8 }} />
        )}
        <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
        <button type="button" className="btn btn-secondary btn-sm" style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => inputRef.current?.click()}>
          <Camera size={14} /> {file ? 'Change photo' : 'Choose a photo'}
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Caption (optional)</label>
        <textarea className="form-input" rows={2} maxLength={CAPTION_MAX} value={caption}
          placeholder="A line about the moment - the business may use this too."
          style={{ margin: 0, resize: 'vertical' }}
          onChange={e => setCaption(e.target.value)} />
      </div>

      <p style={{ margin: '0 0 16px', fontSize: '0.76rem', color: 'var(--muted)', lineHeight: 1.5 }}>
        By submitting, you confirm you took this photo at {business.business_name} and you allow {business.business_name} to
        review it. If they accept it, you receive KrowdKredits. If they offer to license it, you choose whether to agree -
        nothing is licensed without your OK. If they decline, your submission is permanently deleted.
      </p>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={working} style={{ minHeight: 40 }}>
          Cancel
        </button>
        <button className="btn btn-amber btn-sm" onClick={handleSubmit} disabled={working || !file} style={{ minHeight: 40 }}>
          {working ? 'Sharing...' : 'Share it'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A single submission row.
// ─────────────────────────────────────────────────────────────────────────────

function SubmissionRow({ sub, tenantId, onChanged }: {
  sub: SplashSubmission;
  tenantId: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(sub.caption ?? '');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const status = statusLine(sub);

  async function run(action: () => Promise<unknown>) {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      await action();
      onChanged();
    } catch (err: any) {
      setError(err.message || 'That action failed.');
    } finally {
      setWorking(false);
    }
  }

  function handleWithdraw() {
    if (!window.confirm("Withdraw this submission? It's permanently deleted after that - this can't be undone.")) return;
    run(() => withdrawSplash(tenantId, sub.id));
  }

  return (
    <div className="card" style={{ background: 'var(--white)', padding: 16, marginBottom: 16, borderLeft: '4px solid var(--green)' }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <SplashPhoto tenantId={tenantId} submissionId={sub.id} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--green)', marginBottom: 2 }}>
            {sub.business_name}
          </div>

          {editing ? (
            <>
              <textarea className="form-input" rows={2} maxLength={CAPTION_MAX} value={editText}
                style={{ margin: '6px 0', resize: 'vertical' }}
                onChange={e => setEditText(e.target.value)} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 8 }}>
                <button className="btn btn-secondary btn-sm" disabled={working} style={{ minHeight: 32 }}
                  onClick={() => { setEditing(false); setEditText(sub.caption ?? ''); }}>
                  Cancel
                </button>
                <button className="btn btn-amber btn-sm" disabled={working} style={{ minHeight: 32 }}
                  onClick={() => run(async () => {
                    await updateSplashCaption(tenantId, sub.id, editText.trim() || null);
                    setEditing(false);
                  })}>
                  Save
                </button>
              </div>
            </>
          ) : (
            sub.caption && <p style={{ margin: '2px 0 6px', fontSize: '0.85rem', color: 'var(--text)' }}>{sub.caption}</p>
          )}

          <p style={{ margin: '0 0 8px', fontSize: '0.8rem', color: statusColor(status.tone) }}>{status.text}</p>

          {error && <Alert type="error" style={{ marginBottom: 8 }}>{error}</Alert>}

          {sub.status === 'submitted' && !editing && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" disabled={working}
                style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                onClick={() => setEditing(true)}>
                <Pencil size={13} /> Edit caption
              </button>
              <button className="btn btn-secondary btn-sm" disabled={working}
                style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                onClick={handleWithdraw}>
                <Trash2 size={13} /> Withdraw
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Splash() {
  const { user } = useAuth();
  const { tenant } = useTenant();

  const [eligible, setEligible] = useState<SplashEligibleBusiness[]>([]);
  const [submissions, setSubmissions] = useState<SplashSubmission[]>([]);
  const [tombstones, setTombstones] = useState<SplashTombstone[]>([]);
  const [chosenBusiness, setChosenBusiness] = useState<SplashEligibleBusiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const hasLoadedOnce = useRef(false);

  async function fetchAll() {
    if (!tenant) return;
    if (!hasLoadedOnce.current) setLoading(true);
    setError('');
    try {
      const [eligibleRes, mineRes] = await Promise.all([
        getSplashEligible(tenant.id),
        getMySplash(tenant.id),
      ]);
      setEligible(eligibleRes.data);
      setSubmissions(mineRes.data.submissions);
      setTombstones(mineRes.data.tombstones);
    } catch (err: any) {
      setError(err.message || 'Failed to load Social Splash.');
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }

  useEffect(() => { fetchAll(); }, [tenant]);

  if (!user) {
    return (
      <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
        <div style={{ marginBottom: 8 }}>
          <Link to="/profile" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
            &larr; Back to my profile
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
        <Link to="/profile" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to my profile
        </Link>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Camera size={22} style={{ color: 'var(--amber)' }} /> My Splash
      </h1>
      <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Share a photo with a business you've visited. This never appears on the platform - it's private between you and them.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      {loading ? (
        <div style={{ paddingTop: 32, textAlign: 'center' }}>
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          {!chosenBusiness && eligible.length === 0 && (
            <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)', marginBottom: 16 }}>
              <Camera size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
              <p style={{ margin: '0 0 4px', color: 'var(--text)', fontSize: '0.9rem' }}>Nothing to share right now.</p>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
                Scan a participating business's plaque, then come back here within 24 hours to share a photo.
              </p>
            </div>
          )}

          {!chosenBusiness && eligible.length > 0 && (
            <div className="card" style={{ padding: 16, background: 'var(--white)', marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
                Share a photo
              </h3>
              {eligible.map(b => (
                <div key={b.business_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{b.business_name}</div>
                    {b.blurb && <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{b.blurb}</div>}
                  </div>
                  <button className="btn btn-amber btn-sm" style={{ minHeight: 34 }} onClick={() => setChosenBusiness(b)}>
                    Share
                  </button>
                </div>
              ))}
            </div>
          )}

          {chosenBusiness && (
            <SubmitForm
              tenantId={tenant!.id}
              business={chosenBusiness}
              onCancel={() => setChosenBusiness(null)}
              onSubmitted={async () => { setChosenBusiness(null); await fetchAll(); }}
            />
          )}

          {submissions.length === 0 ? (
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>Nothing shared yet.</p>
          ) : (
            submissions.map(sub => (
              <SubmissionRow key={sub.id} sub={sub} tenantId={tenant!.id} onChanged={fetchAll} />
            ))
          )}

          {tombstones.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: '0.9rem', fontFamily: 'var(--font-serif)', color: 'var(--muted)', marginBottom: 8 }}>
                Recently removed
              </h3>
              {tombstones.map(t => (
                <p key={t.id} style={{ margin: '0 0 6px', fontSize: '0.78rem', color: 'var(--muted)' }}>
                  {t.business_name} - removed on {shortDate(t.destroyed_at)}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
