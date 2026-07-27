import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  getSplashEligible, getMySplash, submitSplash, updateSplashCaption, withdrawSplash,
  getSplashMediaViewUrl, respondToSplashOffer, regenerateSplashCertificateCode,
  requestSplashVideoUpload, submitSplashVideo, SPLASH_MAX_VIDEO_SECONDS,
  type SplashEligibleBusiness, type SplashSubmission, type SplashTombstone, type SplashOffer, type SplashCertificate,
} from '../api/splash';
import { Camera, Video, Pencil, Trash2 } from 'lucide-react';
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
    if (sub.open_offer) {
      return { text: `${sub.business_name} would like to license this photo - your call below.`, tone: 'amber' };
    }
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
// A submission's photo or video, loaded through a fresh short-TTL signed view
// URL - raw image-api keys and Stream UIDs never reach the client. Failure is
// quiet: a preview is a nice-to-have, never something that should block the row.
// ─────────────────────────────────────────────────────────────────────────────

function SplashPhoto({ tenantId, submissionId }: { tenantId: string; submissionId: number }) {
  const [media, setMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setMedia(null);
    setFailed(false);
    getSplashMediaViewUrl(tenantId, submissionId)
      .then(res => { if (active) setMedia(res.data); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [tenantId, submissionId]);

  if (failed) return null;
  if (!media) {
    return <div style={{ width: 80, height: 80, borderRadius: 8, background: 'var(--light)', flexShrink: 0 }} />;
  }
  if (media.type === 'video') {
    return (
      <iframe src={media.url} allow="accelerometer; encrypted-media; picture-in-picture;" allowFullScreen
        style={{ width: 140, height: 80, border: 0, borderRadius: 8, display: 'block', flexShrink: 0 }} />
    );
  }
  return <img src={media.url} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, display: 'block', flexShrink: 0 }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Submit form - one eligible business at a time.
// ─────────────────────────────────────────────────────────────────────────────

/** Reads a video file's duration client-side, via an off-DOM <video> element - a courtesy check only, the server re-verifies against Stream's own measured duration. */
function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(el.duration); };
    el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as a video.')); };
    el.src = url;
  });
}

function SubmitForm({ tenantId, business, onCancel, onSubmitted }: {
  tenantId: string;
  business: SplashEligibleBusiness;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const { tenant } = useTenant();

  function resetFile() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
  }

  function switchMode(next: 'photo' | 'video') {
    if (next === mode) return;
    resetFile();
    setError('');
    setMode(next);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    if (mode === 'photo') {
      if (f.size > MAX_PHOTO_BYTES) {
        setError('That photo is over 8 MB - most phone photos are smaller. Try another one.');
        return;
      }
    } else {
      try {
        const duration = await readVideoDuration(f);
        if (duration > SPLASH_MAX_VIDEO_SECONDS) {
          setError(`Videos can be up to ${SPLASH_MAX_VIDEO_SECONDS} seconds - this one is longer. Try a shorter clip.`);
          return;
        }
      } catch (err: any) {
        setError(err.message || 'That file could not be read as a video.');
        return;
      }
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  }

  async function handleSubmitPhoto() {
    if (!file) return;
    const optimized = await resizeForUpload(file);
    await submitSplash(tenantId, business.business_id, optimized, caption);
  }

  async function handleSubmitVideo() {
    if (!file) return;
    setProgress('Uploading...');
    const { data } = await requestSplashVideoUpload(tenantId);
    const form = new FormData();
    form.append('file', file);
    const uploadRes = await fetch(data.upload_url, { method: 'POST', body: form });
    if (!uploadRes.ok) throw new Error('Could not upload the video. Try again.');

    setProgress('Processing your video...');
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await submitSplashVideo(tenantId, business.business_id, data.uid, caption);
        return;
      } catch (err: any) {
        if (!String(err?.message ?? '').includes("isn't ready yet")) throw err;
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    throw new Error("Your video is taking longer than expected to process - wait a moment and try 'Share it' again.");
  }

  async function handleSubmit() {
    if (!file || working) return;
    setWorking(true);
    setError('');
    setProgress('');
    try {
      if (mode === 'photo') await handleSubmitPhoto();
      else await handleSubmitVideo();
      onSubmitted();
    } catch (err: any) {
      setError(err.message || `That ${mode} could not be shared. Try again.`);
    } finally {
      setWorking(false);
      setProgress('');
    }
  }

  return (
    <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        Share with {business.business_name}
      </h3>
      {business.blurb && (
        <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--muted)' }}>{business.blurb}</p>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" className={mode === 'photo' ? 'btn btn-amber btn-sm' : 'btn btn-secondary btn-sm'}
          style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 5 }}
          onClick={() => switchMode('photo')}>
          <Camera size={14} /> Photo
        </button>
        <button type="button" className={mode === 'video' ? 'btn btn-amber btn-sm' : 'btn btn-secondary btn-sm'}
          style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 5 }}
          onClick={() => switchMode('video')}>
          <Video size={14} /> Video
        </button>
      </div>

      {error && <Alert type="error" style={{ marginBottom: 12 }}>{error}</Alert>}

      <div style={{ marginBottom: 12 }}>
        {previewUrl && mode === 'photo' && (
          <img src={previewUrl} alt="" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, display: 'block', marginBottom: 8 }} />
        )}
        {previewUrl && mode === 'video' && (
          <video src={previewUrl} controls style={{ width: 200, maxHeight: 160, borderRadius: 8, display: 'block', marginBottom: 8 }} />
        )}
        <input ref={inputRef} type="file" accept={mode === 'photo' ? 'image/*' : 'video/*'} onChange={handleFile} style={{ display: 'none' }} />
        <button type="button" className="btn btn-secondary btn-sm" style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => inputRef.current?.click()}>
          {mode === 'photo' ? <Camera size={14} /> : <Video size={14} />}
          {file ? `Change ${mode}` : `Choose a ${mode}`}
        </button>
        {mode === 'video' && (
          <p style={{ margin: '6px 0 0', fontSize: '0.76rem', color: 'var(--muted)' }}>
            Up to {SPLASH_MAX_VIDEO_SECONDS} seconds.
          </p>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Caption (optional)</label>
        <textarea className="form-input" rows={2} maxLength={CAPTION_MAX} value={caption}
          placeholder="A line about the moment - the business may use this too."
          style={{ margin: 0, resize: 'vertical' }}
          onChange={e => setCaption(e.target.value)} />
      </div>

      <p style={{ margin: '0 0 16px', fontSize: '0.76rem', color: 'var(--muted)', lineHeight: 1.5 }}>
        By submitting, you confirm you took this {mode} at {business.business_name} and you allow {business.business_name} to
        review it. If they accept it, you receive KrowdKredits. If they offer to license it, you choose whether to agree -
        nothing is licensed without your OK. If they decline, your submission is permanently deleted.
        {mode === 'photo' && (
          <> Until {business.business_name} licenses it, they'll see it with "{tenant?.config.brand_name}" watermarked
          across it - you'll always see your own copy without one.</>
        )}
      </p>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
        {working && progress && <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{progress}</span>}
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
// An open offer on a held submission - agree/pass. Agreeing to a gift
// certificate shows the one-time code right here (also emailed); agreeing to
// credits just settles quietly (the guest's balance is the confirmation).
// ─────────────────────────────────────────────────────────────────────────────

function OfferCard({ offer, tenantId, onChanged }: {
  offer: SplashOffer;
  tenantId: string;
  onChanged: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [certCode, setCertCode] = useState<string | null>(null);

  async function respond(action: 'agree' | 'pass') {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      const res = await respondToSplashOffer(tenantId, offer.id, action);
      if (res.data.certificate_code) {
        // Hold off on refetching - a refetch replaces this row's open_offer
        // with null and unmounts this card before the one-time code could be
        // read. Only refetch once the guest has acknowledged it (below).
        setCertCode(res.data.certificate_code);
      } else {
        onChanged();
      }
    } catch (err: any) {
      setError(err.message || 'That action failed.');
    } finally {
      setWorking(false);
    }
  }

  const considerationText = offer.consideration_type === 'credits'
    ? `${offer.credits_amount} KrowdKredits`
    : `a gift certificate - ${offer.cert_description}`;

  return (
    <div style={{ marginTop: 10, padding: 12, background: 'var(--cream, #f4f1ea)', border: '1px solid var(--border)', borderRadius: 8 }}>
      <p style={{ margin: '0 0 8px', fontSize: '0.85rem', color: 'var(--text)' }}>
        Offering <strong>{considerationText}</strong> to license this photo.
      </p>
      {error && <Alert type="error" style={{ marginBottom: 8 }}>{error}</Alert>}
      {certCode ? (
        <Alert type="success">
          <p style={{ margin: '0 0 8px' }}>
            Certificate code: <strong>{certCode}</strong> - also emailed to you. Show this to redeem it.
          </p>
          <button className="btn btn-secondary btn-sm" style={{ minHeight: 32 }} onClick={onChanged}>
            Got it
          </button>
        </Alert>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-amber btn-sm" disabled={working} onClick={() => respond('agree')} style={{ minHeight: 32 }}>
            Agree
          </button>
          <button className="btn btn-secondary btn-sm" disabled={working} onClick={() => respond('pass')} style={{ minHeight: 32 }}>
            Pass
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A single certificate the guest is holding.
// ─────────────────────────────────────────────────────────────────────────────

function CertificateCard({ cert, tenantId }: { cert: SplashCertificate; tenantId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  async function handleRegenerate() {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      const res = await regenerateSplashCertificateCode(tenantId, cert.id);
      setCode(res.data.claim_code);
    } catch (err: any) {
      setError(err.message || 'Could not get a new code.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card" style={{ background: 'var(--white)', padding: 16, marginBottom: 12, borderLeft: '4px solid var(--amber)' }}>
      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--green)' }}>{cert.business_name}</div>
      <p style={{ margin: '2px 0 8px', fontSize: '0.85rem', color: 'var(--text)' }}>{cert.description}</p>
      <p style={{ margin: '0 0 8px', fontSize: '0.8rem', color: cert.status === 'redeemed' ? 'var(--muted)' : 'var(--sage)' }}>
        {cert.status === 'redeemed' ? 'Redeemed' : 'Active - never expires'}
      </p>
      {error && <Alert type="error" style={{ marginBottom: 8 }}>{error}</Alert>}
      {code && <Alert type="success" style={{ marginBottom: 8 }}>New code: <strong>{code}</strong></Alert>}
      {cert.status === 'active' && !code && (
        <button className="btn btn-secondary btn-sm" disabled={working} onClick={handleRegenerate} style={{ minHeight: 32 }}>
          Lost your code? Get a new one
        </button>
      )}
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

          {sub.open_offer && (
            <OfferCard offer={sub.open_offer} tenantId={tenantId} onChanged={onChanged} />
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
  const [certificates, setCertificates] = useState<SplashCertificate[]>([]);
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
      setCertificates(mineRes.data.certificates);
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

          {certificates.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: '0.9rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', marginBottom: 8 }}>
                My certificates
              </h3>
              {certificates.map(cert => (
                <CertificateCard key={cert.id} cert={cert} tenantId={tenant!.id} />
              ))}
            </div>
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
