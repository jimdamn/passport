import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import {
  adminListSplash, adminRemoveSplash, adminGetSplashConfig, adminSetSplashConfig,
  type AdminSplashRow, type SplashConfig,
} from '../../api/splash';
import { ArrowLeft, Camera, RefreshCw } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';
import { Badge } from '../../components/ui/Badge';

// Social Splash's admin moderation page (Increment 6). Follows AdminFresh.tsx's
// hide-with-required-reason modal pattern (here: remove, one-directional -
// there is no "un-remove", a removed submission proceeds through the same
// destroy_after/tombstone path as any decline). Also carries the step 3a
// admin-editable config form (accept_award_k/hold_days/offer_days/
// destroy_delay_days/max_video_seconds/fee_original_cents) - a small settings
// form on this same page, per the plan.

type BadgeVariant = 'green' | 'amber' | 'red' | 'gray';

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function submissionState(row: AdminSplashRow): { label: string; variant: BadgeVariant } {
  if (row.status === 'licensed') return { label: 'Licensed', variant: 'green' };
  if (row.status === 'held') return { label: 'Accepted - deciding', variant: 'amber' };
  if (row.status === 'submitted') return { label: 'New', variant: 'amber' };
  if (row.status === 'removed') {
    return row.admin_removed_by
      ? { label: 'Removed by admin', variant: 'red' }
      : { label: 'Withdrawn', variant: 'gray' };
  }
  return { label: 'Declined', variant: 'gray' }; // 'declined'
}

const CONFIG_FIELDS: Array<{ key: keyof SplashConfig; label: string; min: number; max: number; hint?: string }> = [
  { key: 'accept_award_k', label: 'Accept award (KrowdKredits)', min: 1, max: 1000 },
  { key: 'hold_days', label: 'Hold window (days)', min: 1, max: 90 },
  { key: 'offer_days', label: 'Offer window (days)', min: 1, max: 60 },
  { key: 'destroy_delay_days', label: 'Destruction delay (days)', min: 1, max: 30 },
  { key: 'max_video_seconds', label: 'Max video length (seconds)', min: 10, max: 300 },
  { key: 'fee_original_cents', label: 'Original-file unlock fee (cents)', min: 0, max: 5000, hint: '199 = $1.99' },
];

function ConfigCard() {
  const { tenant } = useTenant();
  const [config, setConfig] = useState<SplashConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    adminGetSplashConfig(tenant.id).then(res => {
      setConfig(res.data);
      setDraft(Object.fromEntries(Object.entries(res.data).map(([k, v]) => [k, String(v)])));
    }).catch(err => setError(err.message || 'Failed to load config.')).finally(() => setLoading(false));
  }, [tenant]);

  if (loading) return <div className="card" style={{ padding: 20, textAlign: 'center' }}><Spinner size="sm" /></div>;
  if (!config) return null;

  const dirty = CONFIG_FIELDS.some(f => draft[f.key] !== String(config[f.key]));

  async function save() {
    if (!tenant) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const patch: Partial<SplashConfig> = {};
      for (const f of CONFIG_FIELDS) {
        const n = Math.floor(Number(draft[f.key]));
        if (!Number.isFinite(n) || n < f.min || n > f.max) {
          throw new Error(`${f.label} must be between ${f.min} and ${f.max}.`);
        }
        patch[f.key] = n;
      }
      const updated = await adminSetSplashConfig(tenant.id, patch);
      setConfig(updated.data);
      setDraft(Object.fromEntries(Object.entries(updated.data).map(([k, v]) => [k, String(v)])));
      setSaved(true);
    } catch (err: any) {
      setError(err.message || 'Failed to save config.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-title">Settings</div>
      <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Tunable without a redeploy. Nothing here is changed until you press Save.
      </p>
      {error && <Alert type="error" style={{ marginBottom: 12 }}>{error}</Alert>}
      {saved && !dirty && <Alert type="success" style={{ marginBottom: 12 }}>Saved.</Alert>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 14 }}>
        {CONFIG_FIELDS.map(f => (
          <div className="form-group" key={f.key} style={{ margin: 0 }}>
            <label className="form-label" htmlFor={`splash-cfg-${f.key}`}>{f.label}</label>
            <input
              id={`splash-cfg-${f.key}`}
              className="form-input"
              type="number"
              min={f.min}
              max={f.max}
              value={draft[f.key] ?? ''}
              onChange={e => { setDraft(d => ({ ...d, [f.key]: e.target.value })); setSaved(false); }}
            />
            {f.hint && <div className="form-hint">{f.hint}</div>}
          </div>
        ))}
      </div>
      <button className="btn btn-amber btn-sm" disabled={!dirty || saving} onClick={save} style={{ minHeight: 34 }}>
        {saving ? <Spinner size="sm" /> : 'Save'}
      </button>
    </div>
  );
}

export default function AdminSplash() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [rows, setRows] = useState<AdminSplashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const [removeTarget, setRemoveTarget] = useState<AdminSplashRow | null>(null);
  const [reason, setReason] = useState('');
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) { navigate('/profile'); return; }
    if (tenant) fetchAll();
  }, [user, tenant]);

  async function fetchAll() {
    if (!tenant) return;
    setLoading(true);
    setError('');
    try {
      const res = await adminListSplash(tenant.id);
      setRows(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load Social Splash.');
    } finally {
      setLoading(false);
    }
  }

  function openRemove(row: AdminSplashRow) {
    setRemoveTarget(row);
    setReason('');
    setModalError('');
  }

  async function confirmRemove() {
    if (!tenant || !removeTarget || working) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setModalError('A reason is required when removing a submission.');
      return;
    }
    setWorking(true);
    setModalError('');
    try {
      await adminRemoveSplash(tenant.id, removeTarget.id, trimmed);
      setRemoveTarget(null);
      setReason('');
      await fetchAll();
    } catch (err: any) {
      setModalError(err.message || 'Failed to remove that.');
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="main-content" style={{ maxWidth: 900, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Camera size={22} /> Social Splash
        </h1>
        <button onClick={fetchAll} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Content is private between a guest and a business - never shown anywhere on the platform.
        Removing requires a reason the owner will see word for word; a removed submission is
        permanently deleted like any decline, and cannot be undone.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      <ConfigCard />

      {rows.length === 0 ? (
        <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>No submissions yet.</p>
        </div>
      ) : (
        <div className="card" style={{ background: 'var(--white)', overflow: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Business</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Guest</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>State</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Created</th>
                <th style={{ textAlign: 'right', padding: '10px 12px' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const state = submissionState(row);
                const removable = row.status !== 'licensed';
                return (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--green)' }}>{row.business_name}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{row.owner_email ?? '-'}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{row.media_type === 'video' ? 'Video' : 'Photo'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <Badge variant={state.variant}>{state.label}</Badge>
                      {row.admin_removed_reason && (
                        <div style={{ fontSize: '0.74rem', color: 'var(--error)', marginTop: 4 }}>Reason: {row.admin_removed_reason}</div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatDate(row.created_at)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {removable && (
                        <button className="btn btn-danger btn-sm" disabled={working} style={{ minHeight: 32 }}
                          onClick={() => openRemove(row)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {removeTarget && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setRemoveTarget(null)}
        >
          <div className="card" style={{ width: '100%', maxWidth: 440, margin: 0 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', color: 'var(--green)', marginBottom: 8 }}>
              Remove this submission?
            </h2>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
              It's scheduled for permanent deletion right away, same as a decline. The owner will
              see this reason word for word. This cannot be undone.
            </p>
            <div className="form-group">
              <label className="form-label">Reason (required)</label>
              <textarea
                className="form-textarea"
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                placeholder="Why is this submission being removed?"
              />
            </div>
            {modalError && <Alert type="error" style={{ marginBottom: 12 }}>{modalError}</Alert>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setRemoveTarget(null)} disabled={working}>Never mind</button>
              <button className="btn btn-danger" onClick={confirmRemove} disabled={working || !reason.trim()}>
                {working ? <Spinner size="sm" /> : 'Remove it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
