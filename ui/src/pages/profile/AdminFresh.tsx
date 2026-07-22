import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import {
  adminListFreshStands, adminListFreshPosts, adminHideFreshStand, adminHideFreshPost,
  type AdminFreshStandRow, type AdminFreshPostRow,
} from '../../api/fresh';
import { ArrowLeft, Sprout, RefreshCw } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';
import { Badge } from '../../components/ui/Badge';

// Fresh Today's admin moderation page. Any signed-in local can run a stand -
// no merchant verification - so this is the only backstop against bad actors.
// Follows AdminContent.tsx's hide-with-required-reason modal pattern and
// AdminKwestDashboard.tsx's table-in-scroll-container style. Hiding is never
// owner-reversible (src/handlers/fresh.ts setFreshStandVisibility always
// 403s while admin_hidden is set) - only this page's Unhide clears it.

type BadgeVariant = 'green' | 'amber' | 'red' | 'gray';

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function standState(row: AdminFreshStandRow): { label: string; variant: BadgeVariant } {
  if (row.deleted_at) return { label: 'Removed', variant: 'gray' };
  if (row.admin_hidden) return { label: 'Hidden by admin', variant: 'red' };
  if (row.is_hidden) return { label: 'Paused', variant: 'amber' };
  return { label: 'Visible', variant: 'green' };
}

function postState(row: AdminFreshPostRow, now: number): { label: string; variant: BadgeVariant } {
  if (!row.is_active) return { label: 'Removed', variant: 'gray' };
  if (row.admin_hidden) return { label: 'Hidden by admin', variant: 'red' };
  if (row.expires_at <= now) return { label: 'Ended', variant: 'gray' };
  if (row.sold_out) return { label: 'Sold out', variant: 'amber' };
  return { label: 'Live', variant: 'green' };
}

type HideTarget =
  | { kind: 'stand'; row: AdminFreshStandRow }
  | { kind: 'post'; row: AdminFreshPostRow };

export default function AdminFresh() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [tab, setTab] = useState<'stands' | 'posts'>('stands');
  const [stands, setStands] = useState<AdminFreshStandRow[]>([]);
  const [posts, setPosts] = useState<AdminFreshPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const [hideTarget, setHideTarget] = useState<HideTarget | null>(null);
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
      const [standsRes, postsRes] = await Promise.all([
        adminListFreshStands(tenant.id),
        adminListFreshPosts(tenant.id),
      ]);
      setStands(standsRes.data || []);
      setPosts(postsRes.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load Fresh Today.');
    } finally {
      setLoading(false);
    }
  }

  function openHide(target: HideTarget) {
    setHideTarget(target);
    setReason('');
    setModalError('');
  }

  async function confirmHide() {
    if (!tenant || !hideTarget || working) return;
    const trimmed = reason.trim();
    // Defense in depth - the primary UX is the disabled "Hide it" button
    // below, but the server's own 400 copy is mirrored here in case a client
    // race lets an empty reason through to submit.
    if (!trimmed) {
      setModalError(hideTarget.kind === 'stand'
        ? "A reason is required when hiding a member's stand."
        : "A reason is required when hiding a member's post.");
      return;
    }
    setWorking(true);
    setModalError('');
    try {
      if (hideTarget.kind === 'stand') {
        await adminHideFreshStand(tenant.id, hideTarget.row.id, true, trimmed);
      } else {
        await adminHideFreshPost(tenant.id, hideTarget.row.id, true, trimmed);
      }
      setHideTarget(null);
      setReason('');
      await fetchAll();
    } catch (err: any) {
      setModalError(err.message || 'Failed to hide that.');
    } finally {
      setWorking(false);
    }
  }

  async function unhide(target: HideTarget) {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    try {
      if (target.kind === 'stand') {
        await adminHideFreshStand(tenant.id, target.row.id, false);
      } else {
        await adminHideFreshPost(tenant.id, target.row.id, false);
      }
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to unhide that.');
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

  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sprout size={22} /> Fresh Today
        </h1>
        <button onClick={fetchAll} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Any signed-in local can run a stand here - no merchant verification. Hiding requires a
        reason the owner will see word for word, and only an admin can reverse it.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setTab('stands')} className={`btn btn-sm ${tab === 'stands' ? 'btn-amber' : 'btn-secondary'}`} style={{ minHeight: 32 }}>
          Stands ({stands.length})
        </button>
        <button onClick={() => setTab('posts')} className={`btn btn-sm ${tab === 'posts' ? 'btn-amber' : 'btn-secondary'}`} style={{ minHeight: 32 }}>
          Posts ({posts.length})
        </button>
      </div>

      {tab === 'stands' ? (
        stands.length === 0 ? (
          <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>No stands yet.</p>
          </div>
        ) : (
          <div className="card" style={{ background: 'var(--white)', overflow: 'auto', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Owner</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>State</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Created</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }} />
                </tr>
              </thead>
              <tbody>
                {stands.map(s => {
                  const state = standState(s);
                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--green)' }}>{s.name}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{s.owner_email ?? '-'}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <Badge variant={state.variant}>{state.label}</Badge>
                        {!!s.admin_hidden && s.admin_hidden_reason && (
                          <div style={{ fontSize: '0.74rem', color: 'var(--error)', marginTop: 4 }}>Reason: {s.admin_hidden_reason}</div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatDate(s.created_at)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {s.admin_hidden ? (
                          <button className="btn btn-amber btn-sm" disabled={working} style={{ minHeight: 32 }}
                            onClick={() => unhide({ kind: 'stand', row: s })}>
                            Unhide
                          </button>
                        ) : (
                          <button className="btn btn-danger btn-sm" disabled={working} style={{ minHeight: 32 }}
                            onClick={() => openHide({ kind: 'stand', row: s })}>
                            Hide
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        posts.length === 0 ? (
          <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>No posts yet.</p>
          </div>
        ) : (
          <div className="card" style={{ background: 'var(--white)', overflow: 'auto', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Post</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Stand</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>State</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Created</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }} />
                </tr>
              </thead>
              <tbody>
                {posts.map(p => {
                  const state = postState(p, now);
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.body}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{p.stand_name}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <Badge variant={state.variant}>{state.label}</Badge>
                        {!!p.admin_hidden && p.admin_hidden_reason && (
                          <div style={{ fontSize: '0.74rem', color: 'var(--error)', marginTop: 4 }}>Reason: {p.admin_hidden_reason}</div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatDate(p.created_at)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {p.admin_hidden ? (
                          <button className="btn btn-amber btn-sm" disabled={working} style={{ minHeight: 32 }}
                            onClick={() => unhide({ kind: 'post', row: p })}>
                            Unhide
                          </button>
                        ) : (
                          <button className="btn btn-danger btn-sm" disabled={working} style={{ minHeight: 32 }}
                            onClick={() => openHide({ kind: 'post', row: p })}>
                            Hide
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {hideTarget && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setHideTarget(null)}
        >
          <div className="card" style={{ width: '100%', maxWidth: 440, margin: 0 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', color: 'var(--green)', marginBottom: 8 }}>
              Hide {hideTarget.kind === 'stand' ? 'this stand' : 'this post'}?
            </h2>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
              It comes off the board right away. The owner will see this reason word for word,
              and only an admin can undo it.
            </p>
            <div className="form-group">
              <label className="form-label">Reason (required)</label>
              <textarea
                className="form-textarea"
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                placeholder={hideTarget.kind === 'stand' ? 'Why is this stand being hidden?' : 'Why is this post being hidden?'}
              />
            </div>
            {modalError && <Alert type="error" style={{ marginBottom: 12 }}>{modalError}</Alert>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setHideTarget(null)} disabled={working}>Never mind</button>
              <button className="btn btn-danger" onClick={confirmHide} disabled={working || !reason.trim()}>
                {working ? <Spinner size="sm" /> : 'Hide it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
