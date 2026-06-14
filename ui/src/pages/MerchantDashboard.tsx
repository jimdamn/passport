import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  getMyPrizes, createMyPrize, updateMyPrize, deleteMyPrize, getMyClaims,
  getMyBusiness, updateMyBusiness,
  type MerchantPrize, type MerchantClaim, type MerchantPrizeInput, type BusinessProfile,
} from '../api/merchant';
import { ArrowLeft, Plus, Pencil, Trash2, Gift, BadgeCheck, Clock, CheckCircle, XCircle, RefreshCw, Building2 } from 'lucide-react';
import { Alert } from '../components/ui/Alert';
import { Spinner } from '../components/ui/Spinner';
import DealsManager from '../components/merchant/DealsManager';

const CATEGORIES = [
  { value: 'dining',      label: 'Dining & Drinks' },
  { value: 'shopping',    label: 'Boutiques & Shops' },
  { value: 'recreation',  label: 'Parks & Recreation' },
  { value: 'attractions', label: 'Attractions' },
  { value: 'lodging',     label: 'Lodging & B&Bs' },
  { value: 'farmfood',    label: 'Farm & Fresh' },
  { value: 'services',    label: 'Services' },
];

interface FormState {
  name: string;
  prize_type: string;
  value: string;
  details: string;
  probability: string;
  quantity: string;
}

const EMPTY_FORM: FormState = {
  name: '', prize_type: 'merchant_coupon', value: '0', details: '',
  probability: '0.05', quantity: '10',
};

export default function MerchantDashboard() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [prizes, setPrizes] = useState<MerchantPrize[]>([]);
  const [claims, setClaims] = useState<MerchantClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);

  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [bizEdit, setBizEdit] = useState(false);
  const [bizForm, setBizForm] = useState({ category: '', phone: '' });
  const [bizWorking, setBizWorking] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const isVerifiedMerchant = !!user && !!user.business_id && user.business_status === 'verified';

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!isVerifiedMerchant) { navigate('/profile'); return; }
    if (tenant) fetchAll();
  }, [user, tenant]);

  const fetchAll = async () => {
    if (!tenant) return;
    setLoading(true);
    setError('');
    try {
      const [prizesRes, claimsRes, bizRes] = await Promise.all([
        getMyPrizes(tenant.id),
        getMyClaims(tenant.id),
        getMyBusiness(tenant.id),
      ]);
      setPrizes(prizesRes.data || []);
      setClaims(claimsRes.data || []);
      if (bizRes.data) {
        setBusiness(bizRes.data);
        setBizForm({ category: bizRes.data.category, phone: bizRes.data.phone || '' });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load your dashboard.');
    } finally {
      setLoading(false);
    }
  };

  const handleBizSave = async () => {
    if (!tenant || bizWorking) return;
    setBizWorking(true);
    setError('');
    setNotice('');
    try {
      const res = await updateMyBusiness(tenant.id, {
        category: bizForm.category,
        phone: bizForm.phone.trim() || undefined,
      });
      if (res.data) {
        setBusiness(res.data);
        setBizForm({ category: res.data.category, phone: res.data.phone || '' });
      }
      setBizEdit(false);
      setNotice('Business profile updated.');
    } catch (err: any) {
      setError(err.message || 'Failed to update business profile.');
    } finally {
      setBizWorking(false);
    }
  };

  const totalWon = claims.length;
  const totalRedeemed = claims.filter(cl => cl.status === 'claimed').length;
  const awaitingPickup = claims.filter(cl => cl.status === 'pending' && cl.expires_at * 1000 > Date.now()).length;

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    setNotice('');
    setError('');
  };

  const openEdit = (pr: MerchantPrize) => {
    setForm({
      name: pr.name,
      prize_type: pr.prize_type,
      value: String(pr.value),
      details: pr.details ?? '',
      probability: String(pr.probability),
      quantity: String(pr.quantity_left),
    });
    setEditingId(pr.id);
    setShowForm(true);
    setNotice('');
    setError('');
  };

  const handleSubmit = async () => {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const input: MerchantPrizeInput = {
        name: form.name,
        prize_type: form.prize_type,
        value: parseInt(form.value, 10) || 0,
        details: form.details || null,
        probability: parseFloat(form.probability),
        quantity: parseInt(form.quantity, 10),
      };
      if (editingId) {
        await updateMyPrize(tenant.id, editingId, input);
        setNotice('Prize updated. If you changed the win chance or stock, it goes back through a quick admin review before re-entering the draw.');
      } else {
        await createMyPrize(tenant.id, input);
        setNotice('Prize submitted! The network admin will activate it shortly, and then it enters the prize draw.');
      }
      setShowForm(false);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to save the prize.');
    } finally {
      setWorking(false);
    }
  };

  const handlePause = async (pr: MerchantPrize) => {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    try {
      await updateMyPrize(tenant.id, pr.id, { is_active: false });
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to pause the prize.');
    } finally {
      setWorking(false);
    }
  };

  const handleDelete = async (pr: MerchantPrize) => {
    if (!tenant || working) return;
    if (!window.confirm(`Remove "${pr.name}" from your pool?`)) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const res = await deleteMyPrize(tenant.id, pr.id);
      setNotice(res.data.removed ? 'Prize removed.' : 'Prize had win history, so it was deactivated instead of deleted.');
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to remove the prize.');
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return (
      <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}>
        <Spinner size="lg" />
        <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: '0.85rem' }}>Loading your dashboard...</p>
      </div>
    );
  }

  const inputStyle = { minHeight: 36, margin: 0 } as const;
  const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 } as const;

  const claimBadge = (status: string, expiresAt: number) => {
    const expired = status === 'expired' || (status === 'pending' && expiresAt * 1000 <= Date.now());
    if (status === 'claimed') return <span style={{ color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 600 }}><CheckCircle size={11} /> Redeemed</span>;
    if (expired) return <span style={{ color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 600 }}><XCircle size={11} /> Expired</span>;
    return <span style={{ color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 600 }}><Clock size={11} /> Awaiting pickup</span>;
  };

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <BadgeCheck size={22} style={{ color: 'var(--green)' }} /> {user?.business_name || 'Merchant Dashboard'}
        </h1>
        <button onClick={fetchAll} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Your prize pool drives explorers to your door. Add prizes, watch them get won, and redeem winners when they come in.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {notice && <Alert type="success" style={{ marginBottom: 16 }}>{notice}</Alert>}

      {/* Business Profile */}
      {business && (
        <div className="card" style={{ background: 'var(--white)', padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Building2 size={16} /> Business Profile
            </h2>
            {!bizEdit && (
              <button className="btn btn-secondary btn-sm" onClick={() => setBizEdit(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 30 }}>
                <Pencil size={12} /> Edit
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', fontSize: '0.82rem' }}>
            {/* Name — read-only */}
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>Business Name</div>
              <div style={{ color: 'var(--body)' }}>{business.name}</div>
            </div>

            {/* Category — editable */}
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>Business Type</div>
              {bizEdit ? (
                <select className="form-select" value={bizForm.category}
                  onChange={e => setBizForm(f => ({ ...f, category: e.target.value }))}
                  disabled={bizWorking} style={{ minHeight: 32, margin: 0, fontSize: '0.82rem' }}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              ) : (
                <div style={{ color: 'var(--body)' }}>{CATEGORIES.find(c => c.value === business.category)?.label ?? business.category}</div>
              )}
            </div>

            {/* Phone — editable */}
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>
                Contact Phone {business.hide_phone ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(private)</span> : null}
              </div>
              {bizEdit ? (
                <input type="tel" className="form-input" value={bizForm.phone}
                  onChange={e => setBizForm(f => ({ ...f, phone: e.target.value }))}
                  disabled={bizWorking} placeholder="(260) 555-0199"
                  style={{ minHeight: 32, margin: 0, fontSize: '0.82rem' }} />
              ) : (
                <div style={{ color: 'var(--body)' }}>{business.phone || <span style={{ color: 'var(--muted)' }}>—</span>}</div>
              )}
            </div>

            {/* Website — read-only */}
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>Website</div>
              <div style={{ color: 'var(--body)', wordBreak: 'break-all' }}>{business.website || <span style={{ color: 'var(--muted)' }}>—</span>}</div>
            </div>

            {/* Address — read-only */}
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>
                Address {business.hide_address ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(private)</span> : null}
              </div>
              <div style={{ color: 'var(--body)' }}>
                {business.hide_address ? <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>Hidden from public listings</span> : (business.address || <span style={{ color: 'var(--muted)' }}>—</span>)}
              </div>
            </div>

            {/* Description — read-only */}
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>Description</div>
              <div style={{ color: 'var(--body)' }}>{business.description || <span style={{ color: 'var(--muted)' }}>—</span>}</div>
            </div>
          </div>

          {bizEdit && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => { setBizEdit(false); setBizForm({ category: business.category, phone: business.phone || '' }); }} disabled={bizWorking} style={{ minHeight: 32 }}>
                Cancel
              </button>
              <button className="btn btn-amber btn-sm" onClick={handleBizSave} disabled={bizWorking} style={{ minHeight: 32 }}>
                {bizWorking ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { num: totalWon, label: 'Prizes Won' },
          { num: awaitingPickup, label: 'Awaiting Pickup' },
          { num: totalRedeemed, label: 'Redeemed' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '14px 12px', background: 'var(--white)', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--font-serif)' }}>{s.num}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Redeem CTA */}
      <div className="card" style={{ padding: 16, background: 'var(--white)', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text)' }}>
          A winner is at your counter? Verify their claim code and mark it redeemed.
        </p>
        <Link to="/redeem" className="btn btn-amber btn-sm" style={{ textDecoration: 'none', minHeight: 36, display: 'inline-flex', alignItems: 'center' }}>
          Redeem a Claim
        </Link>
      </div>

      {/* Prize pool */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>My Prize Pool</h2>
        <button onClick={openCreate} className="btn btn-amber btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <Plus size={14} /> Add Prize
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1rem', color: 'var(--green)' }}>
            {editingId ? 'Edit Prize' : 'New Prize'}
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Prize name (what the winner sees)</label>
              <input className="form-input" style={inputStyle} value={form.name}
                placeholder="e.g. Free coffee with any pastry"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Type</label>
              <select className="form-select" style={inputStyle} value={form.prize_type}
                disabled={!!editingId}
                onChange={e => setForm(f => ({ ...f, prize_type: e.target.value }))}>
                <option value="merchant_coupon">Coupon / Discount</option>
                <option value="merchant_gift">Gift / Certificate</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Dollar value (for your records)</label>
              <input type="number" className="form-input" style={inputStyle} value={form.value}
                onChange={e => setForm(f => ({ ...f, value: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Terms / fine print (optional)</label>
              <input className="form-input" style={inputStyle} value={form.details}
                placeholder="e.g. One per customer, weekdays only"
                onChange={e => setForm(f => ({ ...f, details: e.target.value }))} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>How many can be won? (-1 = unlimited)</label>
              <input type="number" className="form-input" style={inputStyle} value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Win chance per scan (0.05 = 5%)</label>
              <input type="number" step="0.01" min="0" max="1" className="form-input" style={inputStyle} value={form.probability}
                onChange={e => setForm(f => ({ ...f, probability: e.target.value }))} />
            </div>
          </div>

          <p style={{ margin: '0 0 12px', fontSize: '0.75rem', color: 'var(--muted)' }}>
            New prizes and stock/odds changes are reviewed by the network admin before going live in the draw.
          </p>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)} disabled={working} style={{ minHeight: 34 }}>
              Cancel
            </button>
            <button className="btn btn-amber btn-sm" onClick={handleSubmit} disabled={working} style={{ minHeight: 34 }}>
              {working ? 'Saving...' : editingId ? 'Save Changes' : 'Submit Prize'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
        {prizes.length === 0 ? (
          <div className="card" style={{ padding: 32, textAlign: 'center', background: 'var(--white)' }}>
            <Gift size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
              No prizes yet. Add a coupon or gift to put your business in the prize draw —
              every win sends a visitor to your door.
            </p>
          </div>
        ) : (
          prizes.map(pr => {
            const isActive = pr.is_active === 1;
            return (
              <div key={pr.id} className="card" style={{
                background: 'var(--white)', padding: 16,
                borderLeft: `4px solid ${isActive ? 'var(--green)' : 'var(--amber)'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--green)', fontWeight: 600 }}>{pr.name}</h3>
                      <span style={{
                        fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', padding: '2px 6px',
                        borderRadius: 'var(--r-sm)',
                        background: isActive ? 'rgba(30,51,32,0.08)' : 'rgba(200,134,10,0.1)',
                        color: isActive ? 'var(--green)' : 'var(--amber)',
                      }}>
                        {isActive ? 'Live in the draw' : 'Awaiting admin review'}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {pr.quantity_left === -1 ? 'Unlimited' : `${pr.quantity_left} left`}
                      {' · '}{(pr.probability * 100).toFixed(1)}% per scan
                      {' · '}Won {pr.times_won}× · Redeemed {pr.times_redeemed}×
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignSelf: 'center' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(pr)}
                      style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Pencil size={13} /> Edit
                    </button>
                    {isActive && (
                      <button className="btn btn-secondary btn-sm" onClick={() => handlePause(pr)} disabled={working} style={{ minHeight: 32 }}>
                        Pause
                      </button>
                    )}
                    <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(pr)} disabled={working}
                      style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Kredit deals marketplace */}
      <DealsManager />

      {/* Recent wins */}
      <h2 style={{ margin: '0 0 12px', fontSize: '1.1rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>Recent Wins of Your Prizes</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {claims.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
              No wins yet — once your prizes are live, every win shows up here.
            </p>
          </div>
        ) : (
          claims.map((cl, i) => (
            <div key={i} className="card" style={{ background: 'var(--white)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text)', fontWeight: 600 }}>{cl.prize_name}</p>
                <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--muted)' }}>
                  Won at {cl.plaque_name} · {new Date(cl.created_at * 1000).toLocaleString()}
                </p>
              </div>
              {claimBadge(cl.status, cl.expires_at)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
