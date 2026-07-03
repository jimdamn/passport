import { useEffect, useState } from 'react';
import { useTenant } from '../../context/TenantContext';
import {
  getMerchantDeals, createMerchantDeal, updateMerchantDeal, deleteMerchantDeal,
  CLAIM_WINDOW_PRESETS, claimWindowLabel, type MerchantDeal, type DealInput,
} from '../../api/deals';
import { Plus, Pencil, Trash2, Flame, Tag } from 'lucide-react';
import { Alert } from '../ui/Alert';

interface FormState {
  title: string;
  details: string;
  kredit_price: string;
  quantity: string;
  per_user_limit: string;
  claim_window_minutes: string;
  is_hot_deal: boolean;
}

const EMPTY_FORM: FormState = {
  title: '', details: '', kredit_price: '25', quantity: '5',
  per_user_limit: '1', claim_window_minutes: '20160', is_hot_deal: false,
};

export default function DealsManager() {
  const { tenant } = useTenant();

  const [deals, setDeals] = useState<MerchantDeal[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    if (tenant) fetchDeals();
  }, [tenant]);

  const fetchDeals = async () => {
    if (!tenant) return;
    try {
      const res = await getMerchantDeals(tenant.id);
      setDeals(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load your deals.');
    }
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    setNotice('');
    setError('');
  };

  const openEdit = (d: MerchantDeal) => {
    setForm({
      title: d.title,
      details: d.details ?? '',
      kredit_price: String(d.kredit_price),
      quantity: String(d.quantity_left),
      per_user_limit: String(d.per_user_limit),
      claim_window_minutes: String(d.claim_window_minutes),
      is_hot_deal: d.is_hot_deal === 1,
    });
    setEditingId(d.id);
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
      const input: DealInput = {
        title: form.title,
        details: form.details || null,
        kredit_price: parseInt(form.kredit_price, 10),
        quantity: parseInt(form.quantity, 10),
        per_user_limit: parseInt(form.per_user_limit, 10),
        claim_window_minutes: parseInt(form.claim_window_minutes, 10),
        is_hot_deal: form.is_hot_deal,
      };
      if (editingId) {
        await updateMerchantDeal(tenant.id, editingId, input);
        setNotice('Deal updated. If you changed the price or stock, it goes back through a quick admin review before re-listing.');
      } else {
        await createMerchantDeal(tenant.id, input);
        setNotice('Deal submitted! The network admin will activate it shortly, and then it appears in the Deals marketplace.');
      }
      setShowForm(false);
      await fetchDeals();
    } catch (err: any) {
      setError(err.message || 'Failed to save the deal.');
    } finally {
      setWorking(false);
    }
  };

  const handlePause = async (d: MerchantDeal) => {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    try {
      await updateMerchantDeal(tenant.id, d.id, { is_active: false });
      await fetchDeals();
    } catch (err: any) {
      setError(err.message || 'Failed to pause the deal.');
    } finally {
      setWorking(false);
    }
  };

  const handleDelete = async (d: MerchantDeal) => {
    if (!tenant || working) return;
    if (!window.confirm(`Remove "${d.title}" from the marketplace?`)) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const res = await deleteMerchantDeal(tenant.id, d.id);
      setNotice(res.data.removed ? 'Deal removed.' : 'Deal had purchase history, so it was deactivated instead of deleted.');
      await fetchDeals();
    } catch (err: any) {
      setError(err.message || 'Failed to remove the deal.');
    } finally {
      setWorking(false);
    }
  };

  const inputStyle = { minHeight: 36, margin: 0 } as const;
  const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 } as const;

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tag size={17} /> My Kredit Deals
        </h2>
        <button onClick={openCreate} className="btn btn-amber btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <Plus size={14} /> Add Deal
        </button>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--muted)' }}>
        Deals are purchased with KrowdKredits. Short claim windows create urgency - if a
        buyer doesn't redeem in time, their kredits refund and the slot returns to the pool.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 12 }}>{error}</Alert>}
      {notice && <Alert type="success" style={{ marginBottom: 12 }}>{notice}</Alert>}

      {showForm && (
        <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1rem', color: 'var(--green)' }}>
            {editingId ? 'Edit Deal' : 'New Deal'}
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Deal title (what the buyer sees)</label>
              <input className="form-input" style={inputStyle} value={form.title}
                placeholder="e.g. $5 off any lunch entrée"
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Price in kredits (min 1)</label>
              <input type="number" min="1" className="form-input" style={inputStyle} value={form.kredit_price}
                onChange={e => setForm(f => ({ ...f, kredit_price: e.target.value }))} />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Terms / fine print (optional)</label>
            <input className="form-input" style={inputStyle} value={form.details}
              placeholder="e.g. Dine-in only, weekdays 11am–2pm"
              onChange={e => setForm(f => ({ ...f, details: e.target.value }))} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>How many? (-1 = unlimited)</label>
              <input type="number" className="form-input" style={inputStyle} value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Limit per person</label>
              <input type="number" min="1" max="10" className="form-input" style={inputStyle} value={form.per_user_limit}
                onChange={e => setForm(f => ({ ...f, per_user_limit: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Must be used within</label>
              <select className="form-select" style={inputStyle} value={form.claim_window_minutes}
                onChange={e => setForm(f => ({ ...f, claim_window_minutes: e.target.value }))}>
                {CLAIM_WINDOW_PRESETS.map(p => (
                  <option key={p.minutes} value={String(p.minutes)}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: 'var(--text)', marginBottom: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_hot_deal}
              onChange={e => setForm(f => ({ ...f, is_hot_deal: e.target.checked }))} />
            <Flame size={14} style={{ color: 'var(--error, #c0392b)' }} />
            Hot deal - featured with urgency styling. Great for spurring business during slow hours.
          </label>

          <p style={{ margin: '0 0 12px', fontSize: '0.75rem', color: 'var(--muted)' }}>
            New deals and price/stock changes are reviewed by the network admin before going live.
          </p>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)} disabled={working} style={{ minHeight: 34 }}>
              Cancel
            </button>
            <button className="btn btn-amber btn-sm" onClick={handleSubmit} disabled={working} style={{ minHeight: 34 }}>
              {working ? 'Saving...' : editingId ? 'Save Changes' : 'Submit Deal'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {deals.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
              No deals yet. Post a kredit deal - slow Tuesday lunch? A hot deal with a
              30-minute window puts customers at your counter fast.
            </p>
          </div>
        ) : (
          deals.map(d => {
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
                      <span style={{
                        fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', padding: '2px 6px',
                        borderRadius: 'var(--r-sm)',
                        background: isActive ? 'rgba(30,51,32,0.08)' : 'rgba(200,134,10,0.1)',
                        color: isActive ? 'var(--green)' : 'var(--amber)',
                      }}>
                        {isActive ? 'Live in the marketplace' : 'Awaiting admin review'}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {d.kredit_price} kredits
                      {' · '}{d.quantity_left === -1 ? 'Unlimited' : `${d.quantity_left} left`}
                      {' · '}Use within {claimWindowLabel(d.claim_window_minutes)}
                      {' · '}Claimed {d.times_purchased}× · Redeemed {d.times_redeemed}×
                      {d.times_refunded > 0 && ` · Returned ${d.times_refunded}×`}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignSelf: 'center' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(d)}
                      style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Pencil size={13} /> Edit
                    </button>
                    {isActive && (
                      <button className="btn btn-secondary btn-sm" onClick={() => handlePause(d)} disabled={working} style={{ minHeight: 32 }}>
                        Pause
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
          })
        )}
      </div>
    </div>
  );
}
