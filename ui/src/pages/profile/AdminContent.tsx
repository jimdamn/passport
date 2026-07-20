import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import {
  getAdminExchangeOffers, getAdminFieldNotesStories,
  setExchangeVisibility, setFieldNotesVisibility,
  type AdminExchangeOfferRow, type AdminFieldNotesStoryRow,
} from '../../api/adminContent';
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

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type Confirm =
  | { kind: 'exchange-hide'; row: AdminExchangeOfferRow }
  | { kind: 'exchange-show'; row: AdminExchangeOfferRow }
  | { kind: 'fn-hide'; row: AdminFieldNotesStoryRow }
  | { kind: 'fn-show'; row: AdminFieldNotesStoryRow };

function FilterBar({ q, setQ, from, setFrom, to, setTo, status, setStatus, statusOptions }: {
  q: string; setQ: (v: string) => void;
  from: string; setFrom: (v: string) => void;
  to: string; setTo: (v: string) => void;
  status: string; setStatus: (v: string) => void;
  statusOptions: { label: string; value: string }[];
}) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', flex: '1 1 220px' }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--muted)' }} />
        <input
          className="form-input"
          style={{ paddingLeft: 30, minHeight: 36 }}
          placeholder="Search title or author"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>
      <select className="form-select" style={{ minHeight: 36, width: 160 }} value={status} onChange={e => setStatus(e.target.value)}>
        {statusOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <input type="date" className="form-input" style={{ minHeight: 36, width: 150 }} value={from} onChange={e => setFrom(e.target.value)} aria-label="From" />
      <input type="date" className="form-input" style={{ minHeight: 36, width: 150 }} value={to} onChange={e => setTo(e.target.value)} aria-label="To" />
    </div>
  );
}

const EXCHANGE_STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Active', value: 'active' },
  { label: 'Awaiting trade', value: 'pending' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
  { label: 'Expired', value: 'expired' },
];

const FN_STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Pending review', value: 'pending' },
  { label: 'Needs revision', value: 'needs_revision' },
  { label: 'Published', value: 'published' },
  { label: 'Rejected', value: 'rejected' },
];

function ExchangeTab({ tenant, onConfirm }: { tenant: string; onConfirm: (c: Confirm) => void }) {
  const [qInput, setQInput] = useState('');
  const q = useDebounced(qInput, 350);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');

  const fetchPage = useMemo(() => {
    return (cursor: string | null) =>
      getAdminExchangeOffers(tenant, { q: q || undefined, from: from || undefined, to: to || undefined, status: status || undefined, cursor })
        .then(res => ({ items: res.data.offers, next_cursor: res.data.next_cursor }));
  }, [tenant, q, from, to, status]);

  const { items, loading, error, hasMore, sentinelRef } = useCursorList<AdminExchangeOfferRow>(fetchPage, [tenant, q, from, to, status]);

  return (
    <>
      <FilterBar q={qInput} setQ={setQInput} from={from} setFrom={setFrom} to={to} setTo={setTo} status={status} setStatus={setStatus} statusOptions={EXCHANGE_STATUS_OPTIONS} />
      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {!loading && items.length === 0 ? (
        <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>No posts match.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map(row => {
            const adminHidden = row.hidden_by === 'admin';
            return (
              <div key={row.id} className="card" style={{ background: 'var(--white)', padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
                      <span style={{ fontFamily: 'var(--font-serif)', fontWeight: 'bold', color: 'var(--green)' }}>{row.title}</span>
                      <Badge variant="gray">{row.status}</Badge>
                      {row.is_published === 0 && <Badge variant={adminHidden ? 'red' : 'gray'}>{adminHidden ? 'Hidden by admin' : 'Hidden'}</Badge>}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {row.niche_name} · {formatDate(row.created_at)} · by{' '}
                      <Link to={`/profile/admin/users?q=${encodeURIComponent(row.owner_email)}`} style={{ fontWeight: 600 }}>
                        {row.owner_display_name || row.owner_email}
                      </Link>
                    </div>
                    {adminHidden && row.hidden_reason && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--error)', marginTop: 4 }}>Reason: {row.hidden_reason}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'flex-start' }}>
                    <a href={`https://exchange.lakeandlocals.com/offers/${row.id}?niche=${row.niche_slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ minHeight: 32 }}>
                      View post
                    </a>
                    {row.status === 'active' && !adminHidden && (
                      <button className="btn btn-danger btn-sm" style={{ minHeight: 32 }} onClick={() => onConfirm({ kind: 'exchange-hide', row })}>
                        Suspend post
                      </button>
                    )}
                    {adminHidden && (
                      <button className="btn btn-amber btn-sm" style={{ minHeight: 32 }} onClick={() => onConfirm({ kind: 'exchange-show', row })}>
                        Unsuspend post
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
          {loading && <div className="spinner-center" style={{ padding: 20 }}><Spinner size="md" /></div>}
        </div>
      )}
    </>
  );
}

function FieldNotesTab({ tenant, onConfirm }: { tenant: string; onConfirm: (c: Confirm) => void }) {
  const [qInput, setQInput] = useState('');
  const q = useDebounced(qInput, 350);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const pageSize = 25;

  const fetchPage = useMemo(() => {
    return (cursor: string | null) => {
      const offset = cursor ? Number(cursor) : 0;
      return getAdminFieldNotesStories(tenant, { q: q || undefined, from: from || undefined, to: to || undefined, status: status || undefined, cursor: String(offset), limit: pageSize })
        .then(res => ({
          items: res.data.stories,
          next_cursor: offset + res.data.stories.length < res.data.total ? String(offset + pageSize) : null,
        }));
    };
  }, [tenant, q, from, to, status]);

  const { items, loading, error, hasMore, sentinelRef } = useCursorList<AdminFieldNotesStoryRow>(fetchPage, [tenant, q, from, to, status]);

  return (
    <>
      <FilterBar q={qInput} setQ={setQInput} from={from} setFrom={setFrom} to={to} setTo={setTo} status={status} setStatus={setStatus} statusOptions={FN_STATUS_OPTIONS} />
      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {!loading && items.length === 0 ? (
        <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>No stories match.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map(row => {
            const adminHidden = row.hidden_by === 'admin';
            return (
              <div key={row.id} className="card" style={{ background: 'var(--white)', padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
                      <span style={{ fontFamily: 'var(--font-serif)', fontWeight: 'bold', color: 'var(--green)' }}>{row.title}</span>
                      <Badge variant="gray">{row.status}</Badge>
                      {row.hidden === 1 && <Badge variant={adminHidden ? 'red' : 'gray'}>{adminHidden ? 'Hidden by admin' : 'Hidden'}</Badge>}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {row.category_name ?? 'Uncategorized'} · {formatDate(row.submitted_at)} · by{' '}
                      <Link to={`/profile/admin/users?q=${encodeURIComponent(row.author_name)}`} style={{ fontWeight: 600 }}>
                        {row.author_name}
                      </Link>
                    </div>
                    {adminHidden && row.hidden_reason && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--error)', marginTop: 4 }}>Reason: {row.hidden_reason}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'flex-start' }}>
                    <a href={`https://fieldnotes.lakeandlocals.com/story/${row.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ minHeight: 32 }}>
                      View post
                    </a>
                    {!adminHidden && (
                      <button className="btn btn-danger btn-sm" style={{ minHeight: 32 }} onClick={() => onConfirm({ kind: 'fn-hide', row })}>
                        Suspend post
                      </button>
                    )}
                    {adminHidden && (
                      <button className="btn btn-amber btn-sm" style={{ minHeight: 32 }} onClick={() => onConfirm({ kind: 'fn-show', row })}>
                        Unsuspend post
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
          {loading && <div className="spinner-center" style={{ padding: 20 }}><Spinner size="md" /></div>}
        </div>
      )}
    </>
  );
}

export default function AdminContent() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'exchange' | 'field-notes'>('exchange');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [reason, setReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) navigate('/profile');
  }, [user, navigate]);

  async function handleConfirm() {
    if (!confirm || !tenant) return;
    setActionLoading(true);
    setActionError('');
    try {
      if (confirm.kind === 'exchange-hide') {
        const trimmed = reason.trim();
        if (!trimmed) { setActionError('A reason is required to suspend a post.'); setActionLoading(false); return; }
        await setExchangeVisibility(tenant.id, confirm.row.id, confirm.row.niche_slug, false, trimmed);
      } else if (confirm.kind === 'exchange-show') {
        await setExchangeVisibility(tenant.id, confirm.row.id, confirm.row.niche_slug, true);
      } else if (confirm.kind === 'fn-hide') {
        const trimmed = reason.trim();
        if (!trimmed) { setActionError('A reason is required to suspend a post.'); setActionLoading(false); return; }
        await setFieldNotesVisibility(tenant.id, confirm.row.id, true, trimmed);
      } else {
        await setFieldNotesVisibility(tenant.id, confirm.row.id, false);
      }
      setConfirm(null);
      setReason('');
      setRefreshKey(k => k + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That action failed. Please try again.');
    } finally {
      setActionLoading(false);
    }
  }

  if (!user?.is_admin || !tenant) return null;

  const isHideAction = confirm?.kind === 'exchange-hide' || confirm?.kind === 'fn-hide';

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <h1 style={{ margin: '0 0 6px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileText size={22} /> Content
      </h1>
      <p style={{ margin: '0 0 20px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Suspending a post here requires a reason, shown to the owner. Only you can restore it once suspended this way.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setTab('exchange')} className={`btn btn-sm ${tab === 'exchange' ? 'btn-amber' : 'btn-secondary'}`} style={{ minHeight: 32 }}>
          Exchange posts
        </button>
        <button onClick={() => setTab('field-notes')} className={`btn btn-sm ${tab === 'field-notes' ? 'btn-amber' : 'btn-secondary'}`} style={{ minHeight: 32 }}>
          Field Notes stories
        </button>
      </div>

      {actionError && !confirm && <Alert type="error" style={{ marginBottom: 16 }}>{actionError}</Alert>}

      {tab === 'exchange'
        ? <ExchangeTab key={`ex-${refreshKey}`} tenant={tenant.id} onConfirm={setConfirm} />
        : <FieldNotesTab key={`fn-${refreshKey}`} tenant={tenant.id} onConfirm={setConfirm} />}

      {confirm && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setConfirm(null)}
        >
          <div className="card" style={{ width: '100%', maxWidth: 440, margin: 0 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', color: 'var(--green)', marginBottom: 8 }}>
              {isHideAction ? 'Suspend this post?' : 'Restore this post?'}
            </h2>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
              {isHideAction
                ? 'It comes off the site right away. The owner sees your reason and cannot undo this themselves.'
                : 'It goes back on the site right away, exactly as it was.'}
            </p>
            {isHideAction && (
              <div className="form-group">
                <label className="form-label">Reason (required, shown to the owner)</label>
                <textarea className="form-textarea" value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Why is this post being suspended?" />
              </div>
            )}
            {actionError && <Alert type="error" style={{ marginBottom: 12 }}>{actionError}</Alert>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setConfirm(null)}>Never mind</button>
              <button className={isHideAction ? 'btn btn-danger' : 'btn btn-amber'} onClick={handleConfirm} disabled={actionLoading}>
                {actionLoading ? <Spinner size="sm" /> : (isHideAction ? 'Suspend' : 'Unsuspend')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
