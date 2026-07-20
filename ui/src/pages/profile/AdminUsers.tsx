import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Users, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  getAdminUsers, suspendUser, unsuspendUser, type AdminUserRow,
} from '../../api/adminUsers';
import { useCursorList } from '../../hooks/useCursorList';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';
import { Badge } from '../../components/ui/Badge';

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function AdminUsers() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [segment, setSegment] = useState<'general' | 'business'>('general');
  const [qInput, setQInput] = useState(searchParams.get('q') ?? '');
  const q = useDebounced(qInput, 350);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [confirmTarget, setConfirmTarget] = useState<{ row: AdminUserRow; action: 'suspend' | 'unsuspend' } | null>(null);
  const [reason, setReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) navigate('/profile');
  }, [user, navigate]);

  const fetchPage = useMemo(() => {
    return (cursor: string | null) =>
      getAdminUsers({ segment, q: q || undefined, from: from || undefined, to: to || undefined, cursor })
        .then(res => ({ items: res.data.users, next_cursor: res.data.next_cursor }));
  }, [segment, q, from, to]);

  const { items: users, setItems, loading, error, hasMore, sentinelRef } = useCursorList<AdminUserRow>(
    fetchPage, [segment, q, from, to]
  );

  async function handleConfirm() {
    if (!confirmTarget) return;
    setActionLoading(true);
    setActionError('');
    try {
      const updated = confirmTarget.action === 'suspend'
        ? (await suspendUser(confirmTarget.row.id, reason.trim() || undefined)).data.user
        : (await unsuspendUser(confirmTarget.row.id)).data.user;
      setItems(prev => prev.map(u => u.id === updated.id ? { ...u, ...updated } : u));
      setConfirmTarget(null);
      setReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That action failed. Please try again.');
    } finally {
      setActionLoading(false);
    }
  }

  if (!user?.is_admin) return null;

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <h1 style={{ margin: '0 0 6px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Users size={22} /> Users
      </h1>
      <p style={{ margin: '0 0 20px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Suspending an account signs it out everywhere immediately and blocks new sign-ins until you restore it.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setSegment('general')}
          className={`btn btn-sm ${segment === 'general' ? 'btn-amber' : 'btn-secondary'}`}
          style={{ minHeight: 32 }}
        >
          General users
        </button>
        <button
          onClick={() => setSegment('business')}
          className={`btn btn-sm ${segment === 'business' ? 'btn-amber' : 'btn-secondary'}`}
          style={{ minHeight: 32 }}
        >
          Business users
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--muted)' }} />
          <input
            className="form-input"
            style={{ paddingLeft: 30, minHeight: 36 }}
            placeholder="Search name or email"
            value={qInput}
            onChange={e => setQInput(e.target.value)}
          />
        </div>
        <input
          type="date"
          className="form-input"
          style={{ minHeight: 36, width: 150 }}
          value={from}
          onChange={e => setFrom(e.target.value)}
          aria-label="Joined from"
        />
        <input
          type="date"
          className="form-input"
          style={{ minHeight: 36, width: 150 }}
          value={to}
          onChange={e => setTo(e.target.value)}
          aria-label="Joined to"
        />
      </div>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {actionError && <Alert type="error" style={{ marginBottom: 16 }}>{actionError}</Alert>}

      {!loading && users.length === 0 ? (
        <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>No users match.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {users.map(u => (
            <div key={u.id} className="card" style={{ background: 'var(--white)', padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                    <span style={{ fontFamily: 'var(--font-serif)', fontWeight: 'bold', color: 'var(--green)' }}>
                      {u.display_name || u.email.split('@')[0]}
                    </span>
                    {u.is_active === 0 && <Badge variant="red">Suspended</Badge>}
                    {u.business_name && <Badge variant="sage">{u.business_status}</Badge>}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{u.email}</div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                    Joined {formatDate(u.created_at)}
                    {u.business_name && (
                      <>
                        {' · '}
                        <Link to="/profile/admin/merchants" style={{ fontWeight: 600 }}>{u.business_name}</Link>
                      </>
                    )}
                  </div>
                  {u.is_active === 0 && u.suspended_reason && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--error)', marginTop: 4 }}>
                      Reason: {u.suspended_reason}
                    </div>
                  )}
                </div>
                <button
                  className={`btn btn-sm ${u.is_active === 0 ? 'btn-secondary' : 'btn-danger'}`}
                  style={{ minHeight: 32, flexShrink: 0 }}
                  onClick={() => { setReason(''); setConfirmTarget({ row: u, action: u.is_active === 0 ? 'unsuspend' : 'suspend' }); }}
                >
                  {u.is_active === 0 ? 'Unsuspend' : 'Suspend'}
                </button>
              </div>
            </div>
          ))}
          {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
          {loading && <div className="spinner-center" style={{ padding: 20 }}><Spinner size="md" /></div>}
        </div>
      )}

      {confirmTarget && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setConfirmTarget(null)}
        >
          <div className="card" style={{ width: '100%', maxWidth: 440, margin: 0 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', color: 'var(--green)', marginBottom: 8 }}>
              {confirmTarget.action === 'suspend' ? 'Suspend this account?' : 'Restore this account?'}
            </h2>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
              {confirmTarget.action === 'suspend'
                ? `${confirmTarget.row.display_name || confirmTarget.row.email} will be signed out everywhere immediately and can't sign back in until you unsuspend them.`
                : `${confirmTarget.row.display_name || confirmTarget.row.email} can sign in again right away.`}
            </p>
            {confirmTarget.action === 'suspend' && (
              <div className="form-group">
                <label className="form-label">Reason (optional, stored for your records)</label>
                <textarea
                  className="form-textarea"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={3}
                  placeholder="Why is this account being suspended?"
                />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setConfirmTarget(null)}>Never mind</button>
              <button
                className={confirmTarget.action === 'suspend' ? 'btn btn-danger' : 'btn btn-amber'}
                onClick={handleConfirm}
                disabled={actionLoading}
              >
                {actionLoading ? <Spinner size="sm" /> : (confirmTarget.action === 'suspend' ? 'Suspend' : 'Unsuspend')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
