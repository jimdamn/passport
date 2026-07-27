import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import {
  getAdminKwestHunt, updateAdminKwestHunt, setAdminKwestHuntStatus,
  getAdminKwestSteps, createAdminKwestStep, updateAdminKwestStep, deleteAdminKwestStep, reorderAdminKwestSteps,
  createAdminKwestTestRun,
  type AdminKwestHunt, type AdminKwestStep, type Clue,
} from '../../api/adminKwest';
import StepLocationPicker from '../../components/kwest/StepLocationPicker';
import { ArrowLeft, CheckCircle2, XCircle, Plus, Trash2, ArrowUp, ArrowDown, LayoutDashboard, MapPinned, Save } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';

function toLocalInput(epoch: number): string {
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toEpoch(dateStr: string): number {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

interface StepFormState {
  clues: Clue[];
  hint_body: string;
  hint_after_misses: string;
  target_lat: number;
  target_lng: number;
  radius_m: string;
  step_reward: string;
  minigame_enabled: boolean;
}

function emptyStepForm(): StepFormState {
  return { clues: [{ type: 'riddle', body: '' }], hint_body: '', hint_after_misses: '5', target_lat: 41.9, target_lng: -85.0, radius_m: '75', step_reward: '', minigame_enabled: true };
}

export default function AdminKwestEdit() {
  const { id } = useParams<{ id: string }>();
  const huntId = Number(id);
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [hunt, setHunt] = useState<AdminKwestHunt | null>(null);
  const [steps, setSteps] = useState<AdminKwestStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<React.ReactNode>('');
  const [working, setWorking] = useState(false);

  const [huntForm, setHuntForm] = useState<Record<string, string>>({});
  const [stepForm, setStepForm] = useState<StepFormState | null>(null);
  const [editingStepId, setEditingStepId] = useState<number | null>(null);

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) { navigate('/profile'); return; }
    if (tenant.id && huntId) fetchAll();
  }, [user, tenant.id, huntId]);

  const fetchAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [huntRes, stepsRes] = await Promise.all([getAdminKwestHunt(tenant.id, huntId), getAdminKwestSteps(tenant.id, huntId)]);
      setHunt(huntRes.data);
      setSteps(stepsRes.data || []);
      setHuntForm({
        name: huntRes.data.name,
        narrative: huntRes.data.narrative,
        location_label: huntRes.data.location_label ?? '',
        sponsor_name: huntRes.data.sponsor_name,
        starts_at: toLocalInput(huntRes.data.starts_at),
        ends_at: toLocalInput(huntRes.data.ends_at),
        grand_prize_description: huntRes.data.grand_prize_description,
        grand_prize_kredits: String(huntRes.data.grand_prize_kredits),
        rank2_10_kredits: String(huntRes.data.rank2_10_kredits),
        rank11_20_kredits: String(huntRes.data.rank11_20_kredits),
        step_reward_default: String(huntRes.data.step_reward_default),
        minigame_offer_bp: String(huntRes.data.minigame_offer_bp / 100),
        minigame_max_award: String(huntRes.data.minigame_max_award),
        kk_budget_cap: String(huntRes.data.kk_budget_cap),
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load this hunt.');
    } finally {
      setLoading(false);
    }
  };

  const untested = steps.filter(s => !s.field_test_json);

  const handleSaveHunt = async () => {
    if (working) return;
    setWorking(true); setError(''); setNotice('');
    try {
      await updateAdminKwestHunt(tenant.id, huntId, {
        name: huntForm.name,
        narrative: huntForm.narrative,
        location_label: huntForm.location_label || null,
        sponsor_name: huntForm.sponsor_name,
        starts_at: toEpoch(huntForm.starts_at),
        ends_at: toEpoch(huntForm.ends_at),
        grand_prize_description: huntForm.grand_prize_description,
        grand_prize_kredits: parseInt(huntForm.grand_prize_kredits, 10) || 0,
        rank2_10_kredits: parseInt(huntForm.rank2_10_kredits, 10) || 0,
        rank11_20_kredits: parseInt(huntForm.rank11_20_kredits, 10) || 0,
        step_reward_default: parseInt(huntForm.step_reward_default, 10) || 0,
        minigame_offer_bp: Math.round((parseFloat(huntForm.minigame_offer_bp) || 0) * 100),
        minigame_max_award: parseInt(huntForm.minigame_max_award, 10) || 0,
        kk_budget_cap: parseInt(huntForm.kk_budget_cap, 10) || 0,
      });
      setNotice('Hunt config saved.');
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to save the hunt.');
    } finally {
      setWorking(false);
    }
  };

  const handleStatusChange = async (status: string) => {
    if (working) return;
    setWorking(true); setError(''); setNotice('');
    try {
      await setAdminKwestHuntStatus(tenant.id, huntId, status);
      setNotice(`Status changed to ${status}.`);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to change status.');
    } finally {
      setWorking(false);
    }
  };

  const openCreateStep = () => { setStepForm(emptyStepForm()); setEditingStepId(null); setError(''); setNotice(''); };
  const openEditStep = (s: AdminKwestStep) => {
    setStepForm({
      clues: JSON.parse(s.clues_json),
      hint_body: s.hint_body ?? '',
      hint_after_misses: String(s.hint_after_misses),
      target_lat: s.target_lat,
      target_lng: s.target_lng,
      radius_m: String(s.radius_m),
      step_reward: s.step_reward != null ? String(s.step_reward) : '',
      minigame_enabled: s.minigame_enabled === 1,
    });
    setEditingStepId(s.id);
    setError(''); setNotice('');
  };

  const handleSaveStep = async () => {
    if (!stepForm || working) return;
    const clues = stepForm.clues.filter(c => c.body.trim());
    if (clues.length === 0) { setError('At least one clue is required.'); return; }
    setWorking(true); setError(''); setNotice('');
    try {
      const input = {
        clues,
        hint_body: stepForm.hint_body || null,
        hint_after_misses: parseInt(stepForm.hint_after_misses, 10) || 0,
        target_lat: stepForm.target_lat,
        target_lng: stepForm.target_lng,
        radius_m: parseInt(stepForm.radius_m, 10) || 75,
        step_reward: stepForm.step_reward === '' ? null : parseInt(stepForm.step_reward, 10),
        minigame_enabled: stepForm.minigame_enabled,
      };
      if (editingStepId) {
        await updateAdminKwestStep(tenant.id, editingStepId, input);
        setNotice('Step updated.');
      } else {
        await createAdminKwestStep(tenant.id, huntId, input);
        setNotice('Step added.');
      }
      setStepForm(null);
      setEditingStepId(null);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to save the step.');
    } finally {
      setWorking(false);
    }
  };

  const handleDeleteStep = async (s: AdminKwestStep) => {
    if (working) return;
    if (!window.confirm(`Delete step ${s.seq}? This cannot be undone.`)) return;
    setWorking(true); setError('');
    try {
      await deleteAdminKwestStep(tenant.id, s.id);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to delete the step.');
    } finally {
      setWorking(false);
    }
  };

  const moveStep = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length || working) return;
    const reordered = [...steps];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setWorking(true); setError('');
    try {
      await reorderAdminKwestSteps(tenant.id, huntId, reordered.map(s => s.id));
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to reorder steps.');
    } finally {
      setWorking(false);
    }
  };

  const handleStartTestRun = async () => {
    if (working) return;
    setWorking(true); setError(''); setNotice('');
    try {
      await createAdminKwestTestRun(tenant.id, huntId);
      setNotice(
        <>
          Test run ready - <Link to={`/kwest/${hunt?.slug}`} style={{ fontWeight: 600, color: 'var(--green)' }}>play it now</Link>{' '}
          (your finish will be flagged is_test and never affects real ranks or awards).
        </>
      );
    } catch (err: any) {
      setError(err.message || 'Failed to start the test run.');
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}><Spinner size="lg" /></div>;
  }
  if (!hunt) {
    return <div className="main-content" style={{ paddingTop: 24 }}><Alert type="error">{error || 'Hunt not found.'}</Alert></div>;
  }

  const inputStyle = { minHeight: 36, margin: 0 } as const;
  const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 } as const;

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile/admin/kwest" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> All Hunts
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>{hunt.name}</h1>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>/{hunt.slug} · status: {hunt.status}</p>
        </div>
        <Link to={`/profile/admin/kwest/${huntId}/dashboard`} className="btn btn-secondary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <LayoutDashboard size={14} /> Dashboard
        </Link>
      </div>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {notice && <Alert type="success" style={{ marginBottom: 16 }}>{notice}</Alert>}

      {/* Go-live checklist */}
      <div className="card" style={{ padding: 16, background: 'var(--white)', marginBottom: 20 }}>
        <p style={{ margin: '0 0 10px', fontWeight: 600, color: 'var(--green)', fontSize: '0.92rem' }}>Go-live checklist</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: '0.85rem' }}>
          {untested.length === 0 && steps.length > 0 ? (
            <><CheckCircle2 size={16} style={{ color: 'var(--green)' }} /> Every step has a passing field test.</>
          ) : (
            <><XCircle size={16} style={{ color: 'var(--amber)' }} /> {steps.length === 0 ? 'Add at least one step.' : `${untested.length} of ${steps.length} step(s) still need a field test.`}</>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {hunt.status === 'draft' && (
            <button className="btn btn-amber btn-sm" style={{ minHeight: 34 }} disabled={working} onClick={() => handleStatusChange('live')}>Go Live</button>
          )}
          {hunt.status === 'live' && (
            <button className="btn btn-secondary btn-sm" style={{ minHeight: 34 }} disabled={working} onClick={() => handleStatusChange('paused')}>Pause</button>
          )}
          {hunt.status === 'paused' && (
            <button className="btn btn-amber btn-sm" style={{ minHeight: 34 }} disabled={working} onClick={() => handleStatusChange('live')}>Resume</button>
          )}
          {(hunt.status === 'live' || hunt.status === 'paused') && (
            <button className="btn btn-secondary btn-sm" style={{ minHeight: 34 }} disabled={working} onClick={() => handleStatusChange('ended')}>End Hunt</button>
          )}
          {hunt.status === 'ended' && (
            <button className="btn btn-secondary btn-sm" style={{ minHeight: 34 }} disabled={working} onClick={() => handleStatusChange('archived')}>Archive</button>
          )}
          <button className="btn btn-secondary btn-sm" style={{ minHeight: 34 }} disabled={working} onClick={handleStartTestRun}>Start Test Run</button>
          {/* Test runs work on a hunt in ANY status, draft included (that's the
              whole point - rehearse before going live), so this link is never
              gated on hunt.status. */}
          <Link to={`/kwest/${hunt.slug}`} className="btn btn-secondary btn-sm" style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center' }}>Play it</Link>
        </div>
      </div>

      {/* Hunt config */}
      <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', color: 'var(--green)', fontFamily: 'var(--font-serif)' }}>Hunt Config</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div><label style={labelStyle}>Name</label><input className="form-input" style={inputStyle} value={huntForm.name ?? ''} onChange={e => setHuntForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div><label style={labelStyle}>Location label</label><input className="form-input" style={inputStyle} value={huntForm.location_label ?? ''} onChange={e => setHuntForm(f => ({ ...f, location_label: e.target.value }))} /></div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Narrative (the intro players see)</label>
          <textarea className="form-input" style={{ ...inputStyle, minHeight: 70 }} value={huntForm.narrative ?? ''} onChange={e => setHuntForm(f => ({ ...f, narrative: e.target.value }))} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div><label style={labelStyle}>Starts</label><input type="datetime-local" className="form-input" style={inputStyle} value={huntForm.starts_at ?? ''} onChange={e => setHuntForm(f => ({ ...f, starts_at: e.target.value }))} /></div>
          <div><label style={labelStyle}>Scheduled end</label><input type="datetime-local" className="form-input" style={inputStyle} value={huntForm.ends_at ?? ''} onChange={e => setHuntForm(f => ({ ...f, ends_at: e.target.value }))} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div><label style={labelStyle}>Sponsor</label><input className="form-input" style={inputStyle} value={huntForm.sponsor_name ?? ''} onChange={e => setHuntForm(f => ({ ...f, sponsor_name: e.target.value }))} /></div>
          <div><label style={labelStyle}>Grand prize (real-world)</label><input className="form-input" style={inputStyle} value={huntForm.grand_prize_description ?? ''} onChange={e => setHuntForm(f => ({ ...f, grand_prize_description: e.target.value }))} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div><label style={labelStyle}>Grand prize KrowdKredits</label><input type="number" className="form-input" style={inputStyle} value={huntForm.grand_prize_kredits ?? ''} onChange={e => setHuntForm(f => ({ ...f, grand_prize_kredits: e.target.value }))} /></div>
          <div><label style={labelStyle}>Ranks 2-10 KrowdKredits</label><input type="number" className="form-input" style={inputStyle} value={huntForm.rank2_10_kredits ?? ''} onChange={e => setHuntForm(f => ({ ...f, rank2_10_kredits: e.target.value }))} /></div>
          <div><label style={labelStyle}>Ranks 11-20 KrowdKredits</label><input type="number" className="form-input" style={inputStyle} value={huntForm.rank11_20_kredits ?? ''} onChange={e => setHuntForm(f => ({ ...f, rank11_20_kredits: e.target.value }))} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div><label style={labelStyle}>Default step reward</label><input type="number" className="form-input" style={inputStyle} value={huntForm.step_reward_default ?? ''} onChange={e => setHuntForm(f => ({ ...f, step_reward_default: e.target.value }))} /></div>
          <div><label style={labelStyle}>Mini-game offer chance (%)</label><input type="number" step="0.1" className="form-input" style={inputStyle} value={huntForm.minigame_offer_bp ?? ''} onChange={e => setHuntForm(f => ({ ...f, minigame_offer_bp: e.target.value }))} /></div>
          <div><label style={labelStyle}>Mini-game max award</label><input type="number" className="form-input" style={inputStyle} value={huntForm.minigame_max_award ?? ''} onChange={e => setHuntForm(f => ({ ...f, minigame_max_award: e.target.value }))} /></div>
          <div><label style={labelStyle}>Budget cap</label><input type="number" className="form-input" style={inputStyle} value={huntForm.kk_budget_cap ?? ''} onChange={e => setHuntForm(f => ({ ...f, kk_budget_cap: e.target.value }))} /></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-amber btn-sm" style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 6 }} disabled={working} onClick={handleSaveHunt}>
            <Save size={13} /> Save Config
          </button>
        </div>
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--green)', fontFamily: 'var(--font-serif)' }}>Steps</h3>
        <button className="btn btn-amber btn-sm" style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={openCreateStep}>
          <Plus size={13} /> Add Step
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {steps.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>No steps yet.</p>
          </div>
        ) : (
          steps.map((s, i) => {
            const clues: Clue[] = JSON.parse(s.clues_json);
            return (
              <div key={s.id} className="card" style={{ background: 'var(--white)', padding: 14, borderLeft: `4px solid ${s.field_test_json ? 'var(--green)' : 'var(--amber)'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: '0.9rem', color: 'var(--green)' }}>
                      Step {s.seq}{s.is_final ? ' (final)' : ''}
                    </p>
                    <p style={{ margin: '0 0 4px', fontSize: '0.82rem', color: 'var(--text)' }}>{clues[0]?.body}</p>
                    <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--muted)' }}>
                      Radius {s.radius_m}m · {s.field_test_json ? 'Field-tested' : 'Not field-tested'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignSelf: 'center' }}>
                    <button className="btn btn-secondary btn-sm" style={{ minHeight: 30, padding: '0 8px' }} disabled={i === 0 || working} onClick={() => moveStep(i, -1)}><ArrowUp size={13} /></button>
                    <button className="btn btn-secondary btn-sm" style={{ minHeight: 30, padding: '0 8px' }} disabled={i === steps.length - 1 || working} onClick={() => moveStep(i, 1)}><ArrowDown size={13} /></button>
                    <Link to={`/profile/admin/kwest/${huntId}/field-test?step=${s.id}`} className="btn btn-secondary btn-sm" style={{ minHeight: 30, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <MapPinned size={13} /> Field Test
                    </Link>
                    <button className="btn btn-secondary btn-sm" style={{ minHeight: 30 }} onClick={() => openEditStep(s)}>Edit</button>
                    <button className="btn btn-secondary btn-sm" style={{ minHeight: 30, borderColor: 'var(--error)', color: 'var(--error)' }} disabled={working} onClick={() => handleDeleteStep(s)}><Trash2 size={13} /></button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {stepForm && (
        <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', color: 'var(--green)', fontFamily: 'var(--font-serif)' }}>{editingStepId ? 'Edit Step' : 'New Step'}</h3>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Clue</label>
            <textarea className="form-input" style={{ ...inputStyle, minHeight: 60 }} value={stepForm.clues[0]?.body ?? ''}
              onChange={e => setStepForm(f => f && ({ ...f, clues: [{ ...f.clues[0], body: e.target.value }] }))} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Secret target location (never shown to players)</label>
            <StepLocationPicker
              lat={stepForm.target_lat} lng={stepForm.target_lng}
              onChange={(lat, lng) => setStepForm(f => f && ({ ...f, target_lat: lat, target_lng: lng }))}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>Radius (meters)</label><input type="number" className="form-input" style={inputStyle} value={stepForm.radius_m} onChange={e => setStepForm(f => f && ({ ...f, radius_m: e.target.value }))} /></div>
            <div><label style={labelStyle}>Reward override (blank = hunt default)</label><input type="number" className="form-input" style={inputStyle} value={stepForm.step_reward} onChange={e => setStepForm(f => f && ({ ...f, step_reward: e.target.value }))} /></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>Hint (optional)</label><input className="form-input" style={inputStyle} value={stepForm.hint_body} onChange={e => setStepForm(f => f && ({ ...f, hint_body: e.target.value }))} /></div>
            <div><label style={labelStyle}>Show hint after N misses</label><input type="number" className="form-input" style={inputStyle} value={stepForm.hint_after_misses} onChange={e => setStepForm(f => f && ({ ...f, hint_after_misses: e.target.value }))} /></div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', marginBottom: 16, cursor: 'pointer' }}>
            <input type="checkbox" checked={stepForm.minigame_enabled} onChange={e => setStepForm(f => f && ({ ...f, minigame_enabled: e.target.checked }))} />
            This step may offer a mini-game (skipped automatically on the final step)
          </label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => { setStepForm(null); setEditingStepId(null); }} disabled={working} style={{ minHeight: 34 }}>Cancel</button>
            <button className="btn btn-amber btn-sm" onClick={handleSaveStep} disabled={working} style={{ minHeight: 34 }}>{working ? 'Saving...' : editingStepId ? 'Save Changes' : 'Add Step'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
