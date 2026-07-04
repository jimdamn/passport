import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import {
  getAdminPrizes, createAdminPrize, updateAdminPrize, deleteAdminPrize, getAdminPlaques,
  type AdminPrize, type AdminPlaque, type PrizeInput,
} from '../../api/admin';
import { ArrowLeft, Plus, Pencil, Trash2, RefreshCw, Gift, Timer } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';

const PRIZE_TYPES = [
  { value: 'kredits_base', label: 'KrowdKredits - guaranteed (everyone wins this as the floor)' },
  { value: 'kredits_jackpot', label: 'KrowdKredits - jackpot' },
  { value: 'merchant_coupon', label: 'Coupon / Discount' },
  { value: 'merchant_gift', label: 'Gift / Certificate' },
  { value: 'cash', label: 'Cash' },
];

const typeLabel = (t: string) => PRIZE_TYPES.find(p => p.value === t)?.label.split(' - ')[0].split(' / ')[0] ?? t;

interface FormState {
  name: string;
  prize_type: string;
  value: string;
  details: string;
  probability: string;
  quantity: string;
  plaque_id: string;
  is_paced: boolean;
}

const EMPTY_FORM: FormState = {
  name: '', prize_type: 'merchant_coupon', value: '0', details: '',
  probability: '0.05', quantity: '-1', plaque_id: '', is_paced: false,
};

export default function AdminPrizes() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [prizes, setPrizes] = useState<AdminPrize[]>([]);
  const [plaques, setPlaques] = useState<AdminPlaque[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPaced, setEditingPaced] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) { navigate('/profile'); return; }
    if (tenant) fetchAll();
  }, [user, tenant]);

  const fetchAll = async () => {
    if (!tenant) return;
    setLoading(true);
    setError('');
    try {
      const [prizesRes, plaquesRes] = await Promise.all([
        getAdminPrizes(tenant.id),
        getAdminPlaques(tenant.id),
      ]);
      setPrizes(prizesRes.data || []);
      setPlaques(plaquesRes.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load prizes.');
    } finally {
      setLoading(false);
    }
  };

  const selectedPlaque = plaques.find(p => p.id === form.plaque_id);
  const pacingAvailable = !!selectedPlaque && selectedPlaque.is_event === 1 && !!selectedPlaque.event_start && !!selectedPlaque.event_end;

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setEditingPaced(false);
    setShowForm(true);
    setNotice('');
    setError('');
  };

  const openEdit = (pr: AdminPrize) => {
    setForm({
      name: pr.name,
      prize_type: pr.prize_type,
      value: String(pr.value),
      details: pr.details ?? '',
      probability: String(pr.probability),
      quantity: String(pr.quantity_left),
      plaque_id: pr.plaque_id ?? '',
      is_paced: pr.is_paced === 1,
    });
    setEditingId(pr.id);
    setEditingPaced(pr.is_paced === 1);
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
      if (editingId) {
        const input: Partial<PrizeInput> = {
          name: form.name,
          details: form.details || null,
          value: parseInt(form.value, 10) || 0,
        };
        if (!editingPaced) {
          input.probability = parseFloat(form.probability);
          input.quantity = parseInt(form.quantity, 10);
        }
        await updateAdminPrize(tenant.id, editingId, input);
        setNotice('Prize updated.');
      } else {
        const input: PrizeInput = {
          name: form.name,
          prize_type: form.prize_type,
          value: parseInt(form.value, 10) || 0,
          details: form.details || null,
          plaque_id: form.plaque_id || null,
          is_paced: form.is_paced && pacingAvailable,
          quantity: parseInt(form.quantity, 10),
        };
        if (!input.is_paced && form.prize_type !== 'kredits_base') {
          input.probability = parseFloat(form.probability);
        }
        await createAdminPrize(tenant.id, input);
        setNotice('Prize created and live in the draw.');
      }
      setShowForm(false);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to save the prize.');
    } finally {
      setWorking(false);
    }
  };

  const toggleActive = async (pr: AdminPrize) => {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    try {
      await updateAdminPrize(tenant.id, pr.id, { is_active: pr.is_active !== 1 });
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to update the prize.');
    } finally {
      setWorking(false);
    }
  };

  const handleDelete = async (pr: AdminPrize) => {
    if (!tenant || working) return;
    if (!window.confirm(`Delete "${pr.name}"? If it has already been won it will be deactivated instead so history is kept.`)) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const res = await deleteAdminPrize(tenant.id, pr.id);
      setNotice(res.data.removed ? 'Prize deleted.' : 'Prize had win history, so it was deactivated instead of deleted.');
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to delete the prize.');
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return (
      <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}>
        <Spinner size="lg" />
        <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: '0.85rem' }}>Loading prizes...</p>
      </div>
    );
  }

  const inputStyle = { minHeight: 36, margin: 0 } as const;
  const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 } as const;
  const showProbability = !editingPaced && !form.is_paced && form.prize_type !== 'kredits_base';

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
            Prize Pools
          </h1>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>
            What scanners can win - everywhere, at one plaque, or paced across an event
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchAll} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={openCreate} className="btn btn-amber btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
            <Plus size={14} /> New Prize
          </button>
        </div>
      </div>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {notice && <Alert type="success" style={{ marginBottom: 16 }}>{notice}</Alert>}

      {showForm && (
        <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', color: 'var(--green)' }}>
            {editingId ? 'Edit Prize' : 'New Prize'}
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Prize name (what the winner sees)</label>
              <input className="form-input" style={inputStyle} value={form.name}
                placeholder="e.g. $100 Cash!"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Type</label>
              <select className="form-select" style={inputStyle} value={form.prize_type}
                disabled={!!editingId}
                onChange={e => setForm(f => ({ ...f, prize_type: e.target.value }))}>
                {PRIZE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Value ({form.prize_type.startsWith('kredits') ? 'KrowdKredits awarded' : 'dollar value, for records'})</label>
              <input type="number" className="form-input" style={inputStyle} value={form.value}
                onChange={e => setForm(f => ({ ...f, value: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Details / redemption instructions (optional)</label>
              <input className="form-input" style={inputStyle} value={form.details}
                placeholder="e.g. Show this claim at the Lake & Locals booth"
                onChange={e => setForm(f => ({ ...f, details: e.target.value }))} />
            </div>
          </div>

          {!editingId && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Where can it be won?</label>
                <select className="form-select" style={inputStyle} value={form.plaque_id}
                  onChange={e => setForm(f => ({ ...f, plaque_id: e.target.value, is_paced: false }))}>
                  <option value="">Everywhere (all plaques)</option>
                  {plaques.filter(p => p.is_active === 1).map(p => (
                    <option key={p.id} value={p.id}>
                      {p.is_event === 1 ? '🎉 ' : ''}{p.name} only
                    </option>
                  ))}
                </select>
              </div>
              {pacingAvailable && (
                <div>
                  <label style={labelStyle}>Event pacing</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, fontSize: '0.82rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.is_paced}
                      onChange={e => setForm(f => ({ ...f, is_paced: e.target.checked }))} />
                    Spread wins across the event window (hidden random drop times)
                  </label>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            {!editingPaced && (
              <div>
                <label style={labelStyle}>{form.is_paced ? 'Quantity (units dropped during the event)' : 'Stock (-1 = unlimited)'}</label>
                <input type="number" className="form-input" style={inputStyle} value={form.quantity}
                  onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
              </div>
            )}
            {showProbability && (
              <div>
                <label style={labelStyle}>Win chance per scan (0.05 = 5%)</label>
                <input type="number" step="0.01" min="0" max="1" className="form-input" style={inputStyle} value={form.probability}
                  onChange={e => setForm(f => ({ ...f, probability: e.target.value }))} />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)} disabled={working} style={{ minHeight: 34 }}>
              Cancel
            </button>
            <button className="btn btn-amber btn-sm" onClick={handleSubmit} disabled={working} style={{ minHeight: 34 }}>
              {working ? 'Saving...' : editingId ? 'Save Changes' : 'Create Prize'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {prizes.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              No prizes yet. Start with a guaranteed KrowdKredits prize so every scan wins something.
            </p>
          </div>
        ) : (
          prizes.map(pr => {
            const isActive = pr.is_active === 1;
            const isPaced = pr.is_paced === 1;
            return (
              <div key={pr.id} className="card" style={{
                background: 'var(--white)', padding: 16,
                borderLeft: `4px solid ${!isActive ? 'var(--muted)' : isPaced ? 'var(--amber)' : 'var(--sage, #507850)'}`,
                opacity: isActive ? 1 : 0.65,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                      <Gift size={15} style={{ color: 'var(--amber)' }} />
                      <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--green)', fontWeight: 600 }}>{pr.name}</h3>
                      <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 'var(--r-sm)', background: 'rgba(30,51,32,0.07)', color: 'var(--green)' }}>
                        {typeLabel(pr.prize_type)}
                      </span>
                      {isPaced && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 'var(--r-sm)', background: 'rgba(200,134,10,0.1)', color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Timer size={10} /> Paced
                        </span>
                      )}
                      {pr.merchant_id && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--sage, #507850)' }}>
                          Merchant{!isActive ? ' - needs review' : ''}
                        </span>
                      )}
                      {!isActive && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 'var(--r-sm)', background: 'rgba(0,0,0,0.06)', color: 'var(--muted)' }}>
                          Inactive
                        </span>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {pr.plaque_name ? `At ${pr.plaque_name} only` : 'Available everywhere'}
                      {isPaced
                        ? ` · ${pr.drops_won}/${pr.drops_total} dropped & won`
                        : ` · ${pr.quantity_left === -1 ? 'Unlimited stock' : `${pr.quantity_left} left`}`}
                      {!isPaced && pr.prize_type !== 'kredits_base' && ` · ${(pr.probability * 100).toFixed(1)}% per scan`}
                      {pr.prize_type === 'kredits_base' && ' · Guaranteed floor prize'}
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignSelf: 'center' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(pr)}
                      style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Pencil size={13} /> Edit
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(pr)} disabled={working} style={{ minHeight: 32 }}>
                      {isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(pr)} disabled={working}
                      style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
