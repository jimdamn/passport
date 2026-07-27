import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { getAdminKwestHunts, createAdminKwestHunt, type AdminKwestHunt, type HuntInput } from '../../api/adminKwest';
import { ArrowLeft, Plus, Compass, ChevronRight, RefreshCw } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';

interface FormState {
  slug: string;
  name: string;
  scope: 'location_specific' | 'region_wide';
  location_label: string;
  starts_at: string;
  ends_at: string;
  grand_prize_description: string;
}

const EMPTY_FORM: FormState = {
  slug: '', name: '', scope: 'location_specific', location_label: '', starts_at: '', ends_at: '', grand_prize_description: '',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'var(--muted)', scheduled: 'var(--amber)', live: 'var(--green)',
  paused: 'var(--amber)', ended: 'var(--muted)', archived: 'var(--muted)',
};

function toEpoch(dateStr: string): number {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

export default function AdminKwest() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [hunts, setHunts] = useState<AdminKwestHunt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) { navigate('/profile'); return; }
    if (tenant.id) fetchAll();
  }, [user, tenant.id]);

  const fetchAll = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getAdminKwestHunts(tenant.id);
      setHunts(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load hunts.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      const input: HuntInput = {
        slug: form.slug.trim().toLowerCase(),
        name: form.name,
        scope: form.scope,
        location_label: form.location_label || null,
        starts_at: toEpoch(form.starts_at),
        ends_at: toEpoch(form.ends_at),
        grand_prize_description: form.grand_prize_description,
      };
      const res = await createAdminKwestHunt(tenant.id, input);
      setShowForm(false);
      setForm(EMPTY_FORM);
      navigate(`/profile/admin/kwest/${res.data.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create the hunt.');
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

  const inputStyle = { minHeight: 36, margin: 0 } as const;
  const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 } as const;

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Compass size={22} style={{ color: 'var(--amber)' }} /> KrowdKwest Hunts
          </h1>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>Author, field-test, and run real-world clue hunts.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchAll} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={() => { setShowForm(true); setError(''); }} className="btn btn-amber btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
            <Plus size={14} /> New Hunt
          </button>
        </div>
      </div>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      {showForm && (
        <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', color: 'var(--green)', fontFamily: 'var(--font-serif)' }}>New Hunt</h3>
          <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--muted)' }}>
            Start with the basics - you'll add steps, rewards, and the rest of the config next.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Name (what players see)</label>
              <input className="form-input" style={inputStyle} value={form.name}
                placeholder="e.g. The Union City Trail"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Slug (in the URL, lowercase-hyphens)</label>
              <input className="form-input" style={inputStyle} value={form.slug}
                placeholder="e.g. union-city-trail"
                onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Scope</label>
              <select className="form-select" style={inputStyle} value={form.scope}
                onChange={e => setForm(f => ({ ...f, scope: e.target.value as FormState['scope'] }))}>
                <option value="location_specific">One town / location</option>
                <option value="region_wide">Region-wide</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Location label (optional)</label>
              <input className="form-input" style={inputStyle} value={form.location_label}
                placeholder="e.g. Union City, MI"
                onChange={e => setForm(f => ({ ...f, location_label: e.target.value }))} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Starts</label>
              <input type="datetime-local" className="form-input" style={inputStyle} value={form.starts_at}
                onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Scheduled end</label>
              <input type="datetime-local" className="form-input" style={inputStyle} value={form.ends_at}
                onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))} />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Grand prize (what the winner actually gets)</label>
            <input className="form-input" style={inputStyle} value={form.grand_prize_description}
              placeholder="e.g. $100 cash"
              onChange={e => setForm(f => ({ ...f, grand_prize_description: e.target.value }))} />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)} disabled={working} style={{ minHeight: 34 }}>
              Cancel
            </button>
            <button className="btn btn-amber btn-sm" onClick={handleCreate} disabled={working} style={{ minHeight: 34 }}>
              {working ? 'Creating...' : 'Create Hunt'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {hunts.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)' }}>No hunts yet. Create one to start authoring a trail.</p>
          </div>
        ) : (
          hunts.map(hunt => (
            <Link key={hunt.id} to={`/profile/admin/kwest/${hunt.id}`} className="card" style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
              background: 'var(--white)', padding: 16, textDecoration: 'none',
              borderLeft: `4px solid ${STATUS_COLORS[hunt.status] ?? 'var(--muted)'}`,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--green)', fontWeight: 600, fontFamily: 'var(--font-serif)' }}>{hunt.name}</h3>
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                    borderRadius: 'var(--r-sm)', background: 'rgba(30,51,32,0.07)', color: STATUS_COLORS[hunt.status] ?? 'var(--muted)',
                  }}>
                    {hunt.status}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)' }}>
                  /{hunt.slug} · {hunt.location_label ?? 'Region-wide'} · {hunt.grand_prize_description}
                </p>
              </div>
              <ChevronRight size={18} style={{ color: 'var(--amber)', flexShrink: 0 }} />
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
