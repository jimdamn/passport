import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import {
  getAdminPlaques, createAdminPlaque, updateAdminPlaque, deleteAdminPlaque,
  type AdminPlaque, type PlaqueInput,
} from '../../api/admin';
import { ArrowLeft, Plus, MapPin, Pencil, Trash2, QrCode, Printer, Copy, RefreshCw, PartyPopper } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';

const CATEGORIES = [
  { value: 'dining', label: 'Dining' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'farmfood', label: 'Farm & Food' },
  { value: 'recreation', label: 'Recreation' },
  { value: 'attractions', label: 'Attractions' },
  { value: 'lodging', label: 'Lodging' },
  { value: 'services', label: 'Services' },
];

function toLocalInput(unix: number | null): string {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(s: string): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return isNaN(t) ? null : Math.floor(t / 1000);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface FormState {
  name: string;
  location_name: string;
  category: string;
  lat: string;
  lon: string;
  is_event: boolean;
  event_start: string;
  event_end: string;
}

const EMPTY_FORM: FormState = {
  name: '', location_name: '', category: 'attractions',
  lat: '', lon: '', is_event: false, event_start: '', event_end: '',
};

export default function AdminPlaques() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [plaques, setPlaques] = useState<AdminPlaque[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [qrOpenId, setQrOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) { navigate('/profile'); return; }
    if (tenant) fetchPlaques();
  }, [user, tenant]);

  const fetchPlaques = async () => {
    if (!tenant) return;
    setLoading(true);
    setError('');
    try {
      const res = await getAdminPlaques(tenant.id);
      setPlaques(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load plaques.');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    setNotice('');
    setError('');
  };

  const openEdit = (p: AdminPlaque) => {
    setForm({
      name: p.name,
      location_name: p.location_name,
      category: p.category,
      lat: p.lat ? String(p.lat) : '',
      lon: p.lon ? String(p.lon) : '',
      is_event: p.is_event === 1,
      event_start: toLocalInput(p.event_start),
      event_end: toLocalInput(p.event_end),
    });
    setEditingId(p.id);
    setShowForm(true);
    setNotice('');
    setError('');
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError('This browser does not support location access.'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setForm(f => ({ ...f, lat: pos.coords.latitude.toFixed(6), lon: pos.coords.longitude.toFixed(6) })),
      () => setError('Could not read your location - you can type coordinates manually.'),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleSubmit = async () => {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const input: PlaqueInput = {
        name: form.name,
        location_name: form.location_name,
        category: form.category,
        is_event: form.is_event,
        event_start: form.is_event ? fromLocalInput(form.event_start) : null,
        event_end: form.is_event ? fromLocalInput(form.event_end) : null,
      };
      const lat = parseFloat(form.lat);
      const lon = parseFloat(form.lon);
      if (isFinite(lat) && isFinite(lon)) {
        input.lat = lat;
        input.lon = lon;
      }
      if (editingId) {
        await updateAdminPlaque(tenant.id, editingId, input);
        setNotice('Plaque updated.');
      } else {
        await createAdminPlaque(tenant.id, input);
        setNotice('Plaque created. Open its QR code below to print or copy the scan link.');
      }
      setShowForm(false);
      await fetchPlaques();
    } catch (err: any) {
      setError(err.message || 'Failed to save the plaque.');
    } finally {
      setWorking(false);
    }
  };

  const toggleActive = async (p: AdminPlaque) => {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    try {
      await updateAdminPlaque(tenant.id, p.id, { is_active: p.is_active !== 1 });
      await fetchPlaques();
    } catch (err: any) {
      setError(err.message || 'Failed to update the plaque.');
    } finally {
      setWorking(false);
    }
  };

  const handleDelete = async (p: AdminPlaque) => {
    if (!tenant || working) return;
    if (!window.confirm(`Delete "${p.name}"? If it already has scans it will be deactivated instead so history is kept.`)) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const res = await deleteAdminPlaque(tenant.id, p.id);
      setNotice(res.data.removed ? 'Plaque deleted.' : 'Plaque had scan history, so it was deactivated instead of deleted.');
      await fetchPlaques();
    } catch (err: any) {
      setError(err.message || 'Failed to delete the plaque.');
    } finally {
      setWorking(false);
    }
  };

  const handleCopy = async (p: AdminPlaque) => {
    try {
      await navigator.clipboard.writeText(p.scan_url);
      setCopiedId(p.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const handlePrint = (p: AdminPlaque) => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>${escapeHtml(p.name)} - QR</title></head>
<body style="text-align:center;font-family:Georgia,serif;padding:40px">
<h1 style="margin:0 0 4px">${escapeHtml(p.name)}</h1>
<p style="margin:0 0 24px;color:#555">${escapeHtml(p.location_name)}</p>
<div style="width:380px;margin:0 auto">${p.qr_svg}</div>
<p style="margin-top:24px;font-size:13px;color:#777;word-break:break-all">${escapeHtml(p.scan_url)}</p>
<script>window.onload = () => window.print();</script>
</body></html>`);
    w.document.close();
  };

  if (loading) {
    return (
      <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}>
        <Spinner size="lg" />
        <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: '0.85rem' }}>Loading plaques...</p>
      </div>
    );
  }

  const inputStyle = { minHeight: 36, margin: 0 } as const;
  const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 } as const;

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
            Plaques & Events
          </h1>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>
            Create scannable plaques, print their QR codes, and run roving events
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchPlaques} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={openCreate} className="btn btn-amber btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
            <Plus size={14} /> New Plaque
          </button>
        </div>
      </div>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {notice && <Alert type="success" style={{ marginBottom: 16 }}>{notice}</Alert>}

      {showForm && (
        <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', color: 'var(--green)' }}>
            {editingId ? 'Edit Plaque' : 'New Plaque'}
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input className="form-input" style={inputStyle} value={form.name}
                placeholder="e.g. Courthouse Square"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Location name (shown to visitors)</label>
              <input className="form-input" style={inputStyle} value={form.location_name}
                placeholder="e.g. Downtown Angola"
                onChange={e => setForm(f => ({ ...f, location_name: e.target.value }))} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Category</label>
              <select className="form-select" style={inputStyle} value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(cat => <option key={cat.value} value={cat.value}>{cat.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Type</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, fontSize: '0.85rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_event}
                  onChange={e => setForm(f => ({ ...f, is_event: e.target.checked }))} />
                Roving event (no location check - e.g. QR on a t-shirt)
              </label>
            </div>
          </div>

          {form.is_event ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Event starts</label>
                <input type="datetime-local" className="form-input" style={inputStyle} value={form.event_start}
                  onChange={e => setForm(f => ({ ...f, event_start: e.target.value }))} />
              </div>
              <div>
                <label style={labelStyle}>Event ends</label>
                <input type="datetime-local" className="form-input" style={inputStyle} value={form.event_end}
                  onChange={e => setForm(f => ({ ...f, event_end: e.target.value }))} />
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, marginBottom: 12, alignItems: 'end' }}>
              <div>
                <label style={labelStyle}>Latitude</label>
                <input className="form-input" style={inputStyle} value={form.lat} placeholder="41.6349"
                  onChange={e => setForm(f => ({ ...f, lat: e.target.value }))} />
              </div>
              <div>
                <label style={labelStyle}>Longitude</label>
                <input className="form-input" style={inputStyle} value={form.lon} placeholder="-85.0005"
                  onChange={e => setForm(f => ({ ...f, lon: e.target.value }))} />
              </div>
              <button className="btn btn-secondary btn-sm" onClick={useMyLocation}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36 }}>
                <MapPin size={14} /> Use My Location
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)} disabled={working} style={{ minHeight: 34 }}>
              Cancel
            </button>
            <button className="btn btn-amber btn-sm" onClick={handleSubmit} disabled={working} style={{ minHeight: 34 }}>
              {working ? 'Saving...' : editingId ? 'Save Changes' : 'Create Plaque'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {plaques.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)' }}>No plaques yet. Create your first one to get a printable QR code.</p>
          </div>
        ) : (
          plaques.map(p => {
            const isActive = p.is_active === 1;
            const isEvent = p.is_event === 1;
            return (
              <div key={p.id} className="card" style={{
                background: 'var(--white)', padding: 20,
                borderLeft: `4px solid ${!isActive ? 'var(--muted)' : isEvent ? 'var(--amber)' : 'var(--green)'}`,
                opacity: isActive ? 1 : 0.65,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--green)', fontWeight: 600 }}>{p.name}</h3>
                      {isEvent && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 'var(--r-sm)', background: 'rgba(200, 134, 10, 0.1)', color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <PartyPopper size={10} /> Event
                        </span>
                      )}
                      {!isActive && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 'var(--r-sm)', background: 'rgba(0,0,0,0.06)', color: 'var(--muted)' }}>
                          Inactive
                        </span>
                      )}
                    </div>
                    <p style={{ margin: '0 0 6px', fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {p.location_name} &middot; <span style={{ textTransform: 'capitalize' }}>{p.category}</span> &middot; {p.scan_count} scan{p.scan_count === 1 ? '' : 's'}
                    </p>
                    {isEvent && (p.event_start || p.event_end) && (
                      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)' }}>
                        {p.event_start ? new Date(p.event_start * 1000).toLocaleString() : 'Anytime'}
                        {' → '}
                        {p.event_end ? new Date(p.event_end * 1000).toLocaleString() : 'no end'}
                      </p>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignSelf: 'center' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setQrOpenId(qrOpenId === p.id ? null : p.id)}
                      style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <QrCode size={13} /> QR
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}
                      style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Pencil size={13} /> Edit
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(p)} disabled={working} style={{ minHeight: 32 }}>
                      {isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(p)} disabled={working}
                      style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {qrOpenId === p.id && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border, #ddd8cc)', textAlign: 'center' }}>
                    <div
                      style={{ width: 200, height: 200, margin: '0 auto 12px', padding: 10, background: '#fff', border: '1px solid var(--border, #ddd8cc)', borderRadius: 8 }}
                      dangerouslySetInnerHTML={{ __html: p.qr_svg }}
                    />
                    <p style={{ margin: '0 0 12px', fontSize: '0.7rem', color: 'var(--muted)', wordBreak: 'break-all' }}>{p.scan_url}</p>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => handlePrint(p)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32 }}>
                        <Printer size={13} /> Print
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleCopy(p)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32 }}>
                        <Copy size={13} /> {copiedId === p.id ? 'Copied!' : 'Copy Link'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
