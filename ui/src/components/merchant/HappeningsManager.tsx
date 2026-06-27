import { useEffect, useState } from 'react';
import { useTenant } from '../../context/TenantContext';
import {
  getMerchantHappenings, createHappening, updateHappening, deleteHappening,
  HAPPENING_CATEGORIES, categoryLabel,
  type MerchantHappening, type HappeningInput,
} from '../../api/happenings';
import { getMerchantDeals, type MerchantDeal } from '../../api/deals';
import { Plus, Pencil, Trash2, CalendarDays, Tag } from 'lucide-react';
import { Alert } from '../ui/Alert';

interface FormState {
  body: string;
  category: string;
  show_name: boolean;
  show_address: boolean;
  show_phone: boolean;
  deal_id: string;
}

const EMPTY_FORM: FormState = {
  body: '', category: 'community',
  show_name: true, show_address: true, show_phone: true,
  deal_id: '',
};

const BODY_MAX = 280;

export default function HappeningsManager() {
  const { tenant } = useTenant();

  const [items, setItems] = useState<MerchantHappening[]>([]);
  const [deals, setDeals] = useState<MerchantDeal[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    if (tenant) { fetchItems(); fetchDeals(); }
  }, [tenant]);

  const fetchItems = async () => {
    if (!tenant) return;
    try {
      const res = await getMerchantHappenings(tenant.id);
      setItems(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load your happenings.');
    }
  };

  const fetchDeals = async () => {
    if (!tenant) return;
    try {
      const res = await getMerchantDeals(tenant.id);
      setDeals(res.data || []);
    } catch { /* deal attach is optional; ignore load failure */ }
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    setNotice('');
    setError('');
  };

  const openEdit = (h: MerchantHappening) => {
    setForm({
      body: h.body,
      category: h.category,
      show_name: h.show_name === 1,
      show_address: h.show_address === 1,
      show_phone: h.show_phone === 1,
      deal_id: h.deal_id ?? '',
    });
    setEditingId(h.id);
    setShowForm(true);
    setNotice('');
    setError('');
  };

  const handleSubmit = async () => {
    if (!tenant || working) return;
    if (!form.body.trim()) { setError('Write a short update to post.'); return; }
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const input: HappeningInput = {
        body: form.body,
        category: form.category,
        show_name: form.show_name,
        show_address: form.show_address,
        show_phone: form.show_phone,
        deal_id: form.deal_id || null,
      };
      if (editingId) {
        await updateHappening(tenant.id, editingId, input);
        setNotice('Happening updated.');
      } else {
        await createHappening(tenant.id, input);
        setNotice('Posted! It\'s live on the Happenings board and clears at end of day.');
      }
      setShowForm(false);
      await fetchItems();
    } catch (err: any) {
      setError(err.message || 'Failed to post the happening.');
    } finally {
      setWorking(false);
    }
  };

  const handleDelete = async (h: MerchantHappening) => {
    if (!tenant || working) return;
    if (!window.confirm('Remove this happening from the board?')) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await deleteHappening(tenant.id, h.id);
      setNotice('Happening removed.');
      await fetchItems();
    } catch (err: any) {
      setError(err.message || 'Failed to remove the happening.');
    } finally {
      setWorking(false);
    }
  };

  const inputStyle = { minHeight: 36, margin: 0 } as const;
  const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 } as const;

  const now = Math.floor(Date.now() / 1000);
  const liveCount = items.filter(h => h.is_active === 1 && h.expires_at > now).length;

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <CalendarDays size={17} /> Happenings ({liveCount}/3 live)
        </h2>
        <button onClick={openCreate} className="btn btn-amber btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <Plus size={14} /> Post Update
        </button>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--muted)' }}>
        Share what's happening right now — "Fresh sourdough out at 3," "Live music tonight."
        Posts go live instantly and clear at end of day. Up to 3 live at once.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 12 }}>{error}</Alert>}
      {notice && <Alert type="success" style={{ marginBottom: 12 }}>{notice}</Alert>}

      {showForm && (
        <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1rem', color: 'var(--green)' }}>
            {editingId ? 'Edit Happening' : 'New Happening'}
          </h3>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>What's happening?</label>
            <textarea className="form-input" rows={2} maxLength={BODY_MAX} value={form.body}
              placeholder="e.g. Fresh sourdough out at 3 — still warm!"
              style={{ margin: 0, resize: 'vertical' }}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
            <p style={{ margin: '4px 0 0', fontSize: '0.7rem', color: 'var(--muted)', textAlign: 'right' }}>
              {form.body.length}/{BODY_MAX}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: deals.length ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Category</label>
              <select className="form-select" style={inputStyle} value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {HAPPENING_CATEGORIES.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
            {deals.length > 0 && (
              <div>
                <label style={labelStyle}>Attach a deal (optional)</label>
                <select className="form-select" style={inputStyle} value={form.deal_id}
                  onChange={e => setForm(f => ({ ...f, deal_id: e.target.value }))}>
                  <option value="">None</option>
                  {deals.map(d => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Contact shown when someone taps your post</label>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {([['show_name', 'Business name'], ['show_address', 'Address & map'], ['show_phone', 'Phone']] as const).map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--text)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)} disabled={working} style={{ minHeight: 34 }}>
              Cancel
            </button>
            <button className="btn btn-amber btn-sm" onClick={handleSubmit} disabled={working} style={{ minHeight: 34 }}>
              {working ? 'Posting...' : editingId ? 'Save Changes' : 'Post It'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
              No happenings yet. Post a quick update — it's the easiest way to let neighbors
              know what's going on at your place today.
            </p>
          </div>
        ) : (
          items.map(h => {
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
                      <span style={{
                        fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', padding: '2px 6px',
                        borderRadius: 'var(--r-sm)',
                        background: isLive ? 'rgba(30,51,32,0.08)' : 'rgba(200,134,10,0.1)',
                        color: isLive ? 'var(--green)' : 'var(--amber)',
                      }}>
                        {isLive ? 'Live' : 'Cleared'}
                      </span>
                      {h.deal_title && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <Tag size={11} /> {h.deal_title}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text)' }}>{h.body}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignSelf: 'center' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(h)}
                      style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Pencil size={13} /> Edit
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(h)} disabled={working}
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
