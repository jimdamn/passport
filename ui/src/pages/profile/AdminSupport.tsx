import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import {
  getAdminSupport, adminUpdateSupport, SUPPORT_CATEGORIES,
  type SupportMessage,
} from '../../api/support';
import { ArrowLeft, Inbox, RefreshCw } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';

function categoryLabel(value: string): string {
  return SUPPORT_CATEGORIES.find(c => c.value === value)?.label ?? value;
}

const STATUS_FILTERS = ['new', 'seen', 'resolved', 'all'] as const;

export default function AdminSupport() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [status, setStatus] = useState<typeof STATUS_FILTERS[number]>('new');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) { navigate('/profile'); return; }
    if (tenant) fetchMessages(status);
  }, [user, tenant, status]);

  const fetchMessages = async (s: string) => {
    if (!tenant) return;
    setLoading(true);
    setError('');
    try {
      const res = await getAdminSupport(tenant.id, s);
      setMessages(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load support messages.');
    } finally {
      setLoading(false);
    }
  };

  const save = async (m: SupportMessage, newStatus: SupportMessage['status']) => {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await adminUpdateSupport(tenant.id, m.id, { status: newStatus, admin_note: notes[m.id] ?? m.admin_note ?? undefined });
      setMessages(prev => prev.filter(x => x.id !== m.id || status === 'all'));
      setNotice(newStatus === 'resolved' ? 'Message resolved.' : 'Marked seen.');
      await fetchMessages(status);
    } catch (err: any) {
      setError(err.message || 'Failed to update that message.');
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return (
      <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Inbox size={22} /> Support Inbox
        </h1>
        <button onClick={() => fetchMessages(status)} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Messages from members and businesses across the platform. Resolve closes it out - there are no replies in-app.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {notice && <Alert type="success" style={{ marginBottom: 16 }}>{notice}</Alert>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {STATUS_FILTERS.map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`btn btn-sm ${status === s ? 'btn-amber' : 'btn-secondary'}`}
            style={{ minHeight: 32 }}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {messages.length === 0 ? (
        <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>Nothing here.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map(m => (
            <div key={m.id} className="card" style={{ background: 'var(--white)', padding: 16, borderLeft: '4px solid var(--green)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                    borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
                  }}>
                    {categoryLabel(m.category)}
                  </span>
                  <span style={{
                    fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                    borderRadius: 'var(--r-sm)', background: 'rgba(200,134,10,0.12)', color: 'var(--amber)',
                  }}>
                    {m.source_app}
                  </span>
                </div>
                <span style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                  {new Date(m.created_at * 1000).toLocaleString()}
                </span>
              </div>
              <p style={{ margin: '0 0 8px', fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.5 }}>{m.body}</p>
              <p style={{ margin: '0 0 10px', fontSize: '0.74rem', color: 'var(--muted)' }}>
                {m.email || (m.kkauth_uid ? `Member #${m.kkauth_uid}` : 'Anonymous')}
                {m.email && m.kkauth_uid ? ` (Member #${m.kkauth_uid})` : ''} · {m.route ?? 'no route'}
              </p>
              <textarea
                className="form-textarea"
                value={notes[m.id] ?? m.admin_note ?? ''}
                onChange={e => setNotes(prev => ({ ...prev, [m.id]: e.target.value }))}
                placeholder="Admin note (internal)"
                rows={2}
                style={{ marginBottom: 10 }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {m.status !== 'seen' && (
                  <button className="btn btn-secondary btn-sm" onClick={() => save(m, 'seen')} disabled={working} style={{ minHeight: 32 }}>
                    Mark seen
                  </button>
                )}
                {m.status !== 'resolved' && (
                  <button className="btn btn-amber btn-sm" onClick={() => save(m, 'resolved')} disabled={working} style={{ minHeight: 32 }}>
                    Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
