import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import {
  getAdminHappenings, adminUpdateHappening, adminDeleteHappening,
  HAPPENING_CATEGORIES, categoryLabel,
  type MerchantHappening, type HappeningInput,
} from '../../api/happenings';
import { ArrowLeft, CalendarDays, Trash2, CheckCircle, PauseCircle, RefreshCw, Store, Pencil, Tag } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';

const BODY_MAX = 280;

export default function AdminHappenings() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [items, setItems] = useState<MerchantHappening[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [editing, setEditing] = useState<MerchantHappening | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editCategory, setEditCategory] = useState('community');

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) { navigate('/profile'); return; }
    if (tenant) fetchItems();
  }, [user, tenant]);

  const fetchItems = async () => {
    if (!tenant) return;
    setLoading(true);
    setError('');
    try {
      const res = await getAdminHappenings(tenant.id);
      setItems(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load happenings.');
    } finally {
      setLoading(false);
    }
  };

  const setActive = async (h: MerchantHappening, active: boolean) => {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await adminUpdateHappening(tenant.id, h.id, { is_active: active });
      setNotice(active ? 'Happening published.' : 'Happening unpublished.');
      await fetchItems();
    } catch (err: any) {
      setError(err.message || 'Failed to update the happening.');
    } finally {
      setWorking(false);
    }
  };

  const openEdit = (h: MerchantHappening) => {
    setEditing(h);
    setEditBody(h.body);
    setEditCategory(h.category);
    setNotice('');
    setError('');
  };

  const saveEdit = async () => {
    if (!tenant || !editing || working) return;
    setWorking(true);
    setError('');
    try {
      const input: HappeningInput = { body: editBody, category: editCategory };
      await adminUpdateHappening(tenant.id, editing.id, input);
      setNotice('Happening updated.');
      setEditing(null);
      await fetchItems();
    } catch (err: any) {
      setError(err.message || 'Failed to save changes.');
    } finally {
      setWorking(false);
    }
  };

  const handleDelete = async (h: MerchantHappening) => {
    if (!tenant || working) return;
    if (!window.confirm('Remove this happening permanently?')) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await adminDeleteHappening(tenant.id, h.id);
      setNotice('Happening removed.');
      await fetchItems();
    } catch (err: any) {
      setError(err.message || 'Failed to remove the happening.');
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

  const now = Math.floor(Date.now() / 1000);
  const live = items.filter(h => h.is_active === 1 && h.expires_at > now);
  const rest = items.filter(h => !(h.is_active === 1 && h.expires_at > now));

  const card = (h: MerchantHappening) => {
    const isLive = h.is_active === 1 && h.expires_at > now;
    return (
      <div key={h.id} className="card" style={{
        background: 'var(--white)', padding: 16,
        borderLeft: `4px solid ${isLive ? 'var(--green)' : 'var(--amber)'}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)',
              }}>
                {categoryLabel(h.category)}
              </span>
              {h.deal_title && (
                <span style={{ fontSize: '0.7rem', color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Tag size={11} /> {h.deal_title}
                </span>
              )}
            </div>
            <p style={{ margin: '0 0 4px', fontSize: '0.88rem', color: 'var(--text)' }}>{h.body}</p>
            <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Store size={11} /> {h.merchant_name ?? h.merchant_id}
              {' · '}posted {new Date(h.created_at * 1000).toLocaleString()}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignSelf: 'center' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => openEdit(h)}
              style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Pencil size={13} /> Edit
            </button>
            {isLive ? (
              <button className="btn btn-secondary btn-sm" onClick={() => setActive(h, false)} disabled={working}
                style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <PauseCircle size={13} /> Unpublish
              </button>
            ) : h.expires_at > now ? (
              <button className="btn btn-amber btn-sm" onClick={() => setActive(h, true)} disabled={working}
                style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <CheckCircle size={13} /> Publish
              </button>
            ) : null}
            <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(h)} disabled={working}
              style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)' }}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <CalendarDays size={22} /> Happenings
        </h1>
        <button onClick={fetchItems} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Verified merchants post here live - no approval needed. Use this page to review, edit,
        or unpublish anything that doesn't belong. Posts clear themselves at end of day.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {notice && <Alert type="success" style={{ marginBottom: 16 }}>{notice}</Alert>}

      {editing && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(30,51,32,0.55)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }} onClick={() => setEditing(null)}>
          <div className="card" style={{ background: 'var(--white)', padding: 24, maxWidth: 420, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
              Edit Happening
            </h2>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>Update text</label>
            <textarea className="form-input" rows={3} maxLength={BODY_MAX} value={editBody}
              style={{ margin: '0 0 12px', resize: 'vertical' }}
              onChange={e => setEditBody(e.target.value)} />
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>Category</label>
            <select className="form-select" style={{ minHeight: 36, margin: '0 0 16px' }} value={editCategory}
              onChange={e => setEditCategory(e.target.value)}>
              {HAPPENING_CATEGORIES.map(c => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)} disabled={working} style={{ minHeight: 34 }}>Cancel</button>
              <button className="btn btn-amber btn-sm" onClick={saveEdit} disabled={working} style={{ minHeight: 34 }}>
                {working ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <h2 style={{ margin: '0 0 12px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        Live on the Board ({live.length})
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
        {live.length === 0 ? (
          <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>Nothing live right now.</p>
          </div>
        ) : live.map(card)}
      </div>

      <h2 style={{ margin: '0 0 12px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--amber)' }}>
        Unpublished & Cleared ({rest.length})
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rest.length === 0 ? (
          <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>Nothing here.</p>
          </div>
        ) : rest.map(card)}
      </div>
    </div>
  );
}
