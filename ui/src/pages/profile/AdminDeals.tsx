import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import {
  getAdminDeals, adminUpdateDeal, adminDeleteDeal, claimWindowLabel,
  type MerchantDeal,
} from '../../api/deals';
import { ArrowLeft, Flame, Trash2, Tag, CheckCircle, PauseCircle, RefreshCw, Store } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';

export default function AdminDeals() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [deals, setDeals] = useState<MerchantDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) { navigate('/profile'); return; }
    if (tenant) fetchDeals();
  }, [user, tenant]);

  const fetchDeals = async () => {
    if (!tenant) return;
    setLoading(true);
    setError('');
    try {
      const res = await getAdminDeals(tenant.id);
      setDeals(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load deals.');
    } finally {
      setLoading(false);
    }
  };

  const setActive = async (d: MerchantDeal, active: boolean) => {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await adminUpdateDeal(tenant.id, d.id, { is_active: active });
      setNotice(active ? `"${d.title}" is now live in the marketplace.` : `"${d.title}" was paused.`);
      await fetchDeals();
    } catch (err: any) {
      setError(err.message || 'Failed to update the deal.');
    } finally {
      setWorking(false);
    }
  };

  const handleDelete = async (d: MerchantDeal) => {
    if (!tenant || working) return;
    if (!window.confirm(`Remove "${d.title}"?`)) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const res = await adminDeleteDeal(tenant.id, d.id);
      setNotice(res.data.removed ? 'Deal removed.' : 'Deal had purchase history, so it was deactivated instead of deleted.');
      await fetchDeals();
    } catch (err: any) {
      setError(err.message || 'Failed to remove the deal.');
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

  const pending = deals.filter(d => d.is_active === 0);
  const live = deals.filter(d => d.is_active === 1);

  const dealCard = (d: MerchantDeal) => {
    const isActive = d.is_active === 1;
    return (
      <div key={d.id} className="card" style={{
        background: 'var(--white)', padding: 16,
        borderLeft: `4px solid ${isActive ? 'var(--green)' : 'var(--amber)'}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
              {d.is_hot_deal === 1 && <Flame size={14} style={{ color: 'var(--error, #c0392b)' }} />}
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--green)', fontWeight: 600 }}>{d.title}</h3>
            </div>
            <p style={{ margin: '0 0 2px', fontSize: '0.76rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Store size={11} /> {d.merchant_name ?? d.merchant_id}
            </p>
            {d.details && <p style={{ margin: '0 0 4px', fontSize: '0.78rem', color: 'var(--text)' }}>{d.details}</p>}
            <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--muted)' }}>
              {d.kredit_price} KrowdKredits
              {' · '}{d.quantity_left === -1 ? 'Unlimited' : `${d.quantity_left} left`}
              {' · '}Limit {d.per_user_limit}/person
              {' · '}Use within {claimWindowLabel(d.claim_window_minutes)}
              {' · '}Claimed {d.times_purchased}× · Redeemed {d.times_redeemed}×
              {d.times_refunded > 0 && ` · Returned ${d.times_refunded}×`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignSelf: 'center' }}>
            {isActive ? (
              <button className="btn btn-secondary btn-sm" onClick={() => setActive(d, false)} disabled={working}
                style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <PauseCircle size={13} /> Pause
              </button>
            ) : (
              <button className="btn btn-amber btn-sm" onClick={() => setActive(d, true)} disabled={working}
                style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <CheckCircle size={13} /> Approve & Go Live
              </button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(d)} disabled={working}
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
          <Tag size={22} /> Deal Review
        </h1>
        <button onClick={fetchDeals} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Merchant deals wait here until you approve them. Price and stock edits send a live
        deal back for re-review automatically.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {notice && <Alert type="success" style={{ marginBottom: 16 }}>{notice}</Alert>}

      <h2 style={{ margin: '0 0 12px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--amber)' }}>
        Awaiting Review ({pending.length})
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
        {pending.length === 0 ? (
          <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>Nothing waiting - all caught up.</p>
          </div>
        ) : pending.map(dealCard)}
      </div>

      <h2 style={{ margin: '0 0 12px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        Live in the Marketplace ({live.length})
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {live.length === 0 ? (
          <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>No live deals yet.</p>
          </div>
        ) : live.map(dealCard)}
      </div>
    </div>
  );
}
