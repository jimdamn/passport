import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SponsorDrawer, SponsorBanner, resizeForUpload } from 'kk-shared-ui';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import {
  adminListSponsors, adminCreateSponsor, adminUpdateSponsor, adminSetSponsorActive,
  adminEndSponsor, adminDeleteSponsor, adminGetSponsorFeature, adminSetSponsorFeature,
  adminGetInlineSponsorsFeature, adminSetInlineSponsorsFeature,
  uploadSponsorPhoto, routeLabel, appLabel, placementLabel, SPONSOR_APPS, SPONSOR_ROUTES_BY_APP,
  SPONSOR_PLACEMENTS, SPONSOR_BANNER_SIZES, INLINE_PLACEMENTS,
  type AdminSponsor, type SponsorInput, type SponsorTargetKind, type SponsorApp,
  type SponsorPlacementType, type SponsorBannerSize,
} from '../../api/sponsors';
import {
  ArrowLeft, Handshake, Plus, Pencil, Trash2, PauseCircle, CheckCircle, RefreshCw,
  Square, Eye,
} from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';

function toLocalInput(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(s: string): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return isNaN(t) ? null : t;
}

interface FormState {
  sponsor_name: string;
  message: string;
  app: SponsorApp;
  route: string;
  placement: SponsorPlacementType;
  banner_size: SponsorBannerSize | null;
  show_credit_line: boolean;
  target_kind: SponsorTargetKind;
  target_value: string;
  link_url: string;
  image_url: string;
  starts_at: string;
  ends_at: string;
}

const EMPTY_FORM: FormState = {
  sponsor_name: '', message: '', app: SPONSOR_APPS[0].value, route: SPONSOR_ROUTES_BY_APP[SPONSOR_APPS[0].value][0].value,
  placement: 'route_drawer', banner_size: null, show_credit_line: true,
  target_kind: 'region', target_value: '', link_url: '', image_url: '',
  starts_at: '', ends_at: '',
};

const STATE_COLOR: Record<string, string> = {
  live: 'var(--green)',
  scheduled: 'var(--amber)',
  ended: 'var(--muted)',
  paused: 'var(--muted)',
  feature_off: 'var(--muted)',
};

function targetChip(s: AdminSponsor): string {
  if (s.target_kind === 'region') return 'Region-wide';
  if (s.target_kind === 'zip') return `ZIP ${s.target_value}`;
  return s.target_value ?? 'City';
}

export default function AdminSponsors() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [sponsors, setSponsors] = useState<AdminSponsor[]>([]);
  const [featureOn, setFeatureOn] = useState<boolean | null>(null);
  const [inlineFeatureOn, setInlineFeatureOn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  // Bring the Edit Placement card into view - the trigger button lives in a
  // list row that can be far down the page, and the form renders above the
  // list, so without this the admin edits a placement they can't see.
  useEffect(() => {
    if (showForm && editingId !== null) {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showForm, editingId]);
  // Live preview renders the REAL kk-shared-ui SponsorDrawer (fixed to the
  // real screen edge, exactly as a visitor would see it) rather than a
  // boxed facsimile - id 0 is never a real placement, so a stray tap's
  // beacon call is silently dropped server-side. previewDismissed lets Jim
  // also try the X and bring the preview back, same as the real UX.
  const [previewDismissed, setPreviewDismissed] = useState(false);

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
      const [listRes, featureRes, inlineFeatureRes] = await Promise.all([
        adminListSponsors(tenant.id),
        adminGetSponsorFeature(tenant.id),
        adminGetInlineSponsorsFeature(tenant.id),
      ]);
      setSponsors(listRes.data || []);
      setFeatureOn(featureRes.data.on);
      setInlineFeatureOn(inlineFeatureRes.data.on);
    } catch (err: any) {
      setError(err.message || 'Failed to load sponsor placements.');
    } finally {
      setLoading(false);
    }
  };

  const toggleFeature = async () => {
    if (!tenant || working || featureOn === null) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const res = await adminSetSponsorFeature(tenant.id, !featureOn);
      setFeatureOn(res.data.on);
      setNotice(res.data.on ? 'Sponsor drawer is now ON across the Hub.' : 'Sponsor drawer is now OFF everywhere.');
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to update the feature toggle.');
    } finally {
      setWorking(false);
    }
  };

  const toggleInlineFeature = async () => {
    if (!tenant || working || inlineFeatureOn === null) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const res = await adminSetInlineSponsorsFeature(tenant.id, !inlineFeatureOn);
      setInlineFeatureOn(res.data.on);
      setNotice(res.data.on ? 'Inline banners are now ON across the Hub.' : 'Inline banners are now OFF everywhere.');
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to update the feature toggle.');
    } finally {
      setWorking(false);
    }
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    setPreviewDismissed(false);
    setNotice('');
    setError('');
  };

  const openEdit = (s: AdminSponsor) => {
    setForm({
      sponsor_name: s.sponsor_name,
      message: s.message,
      app: s.app as SponsorApp,
      route: s.route,
      placement: s.placement,
      banner_size: s.banner_size,
      show_credit_line: s.show_credit_line,
      target_kind: s.target_kind,
      target_value: s.target_value ?? '',
      link_url: s.link_url ?? '',
      image_url: s.image_url ?? '',
      starts_at: s.starts_at ? toLocalInput(new Date(s.starts_at.replace(' ', 'T') + 'Z').getTime()) : '',
      ends_at: s.ends_at ? toLocalInput(new Date(s.ends_at.replace(' ', 'T') + 'Z').getTime()) : '',
    });
    setEditingId(s.id);
    setShowForm(true);
    setPreviewDismissed(false);
    setNotice('');
    setError('');
  };

  const openRelist = (s: AdminSponsor) => {
    openEdit(s);
    setForm(f => ({ ...f, starts_at: '', ends_at: '' }));
  };

  const handleUpload = async (file: File) => {
    if (!tenant) return;
    setUploading(true);
    setError('');
    try {
      const optimized = await resizeForUpload(file);
      const res = await uploadSponsorPhoto(tenant.id, optimized, form.placement);
      if (res.data.url) setForm(f => ({ ...f, image_url: res.data.url! }));
    } catch (err: any) {
      setError(err.message || 'Photo upload failed - you can still save without one.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const isInline = INLINE_PLACEMENTS.has(form.placement);
      const input: SponsorInput = {
        sponsor_name: form.sponsor_name,
        message: form.message,
        app: form.app,
        route: form.route,
        placement: form.placement,
        banner_size: isInline ? form.banner_size : null,
        show_credit_line: form.show_credit_line,
        target_kind: form.target_kind,
        target_value: form.target_kind === 'region' ? null : form.target_value,
        link_url: form.link_url || null,
        image_url: form.image_url || null,
        starts_at: fromLocalInput(form.starts_at),
        ends_at: fromLocalInput(form.ends_at),
      };
      if (editingId) {
        await adminUpdateSponsor(tenant.id, editingId, input);
        setNotice('Sponsor placement updated.');
      } else {
        await adminCreateSponsor(tenant.id, input);
        setNotice('Sponsor placement created.');
      }
      setShowForm(false);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to save the sponsor placement.');
    } finally {
      setWorking(false);
    }
  };

  const setActive = async (s: AdminSponsor, active: boolean) => {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await adminSetSponsorActive(tenant.id, s.id, active);
      setNotice(active ? `"${s.sponsor_name}" resumed.` : `"${s.sponsor_name}" paused.`);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to update the placement.');
    } finally {
      setWorking(false);
    }
  };

  const endNow = async (s: AdminSponsor) => {
    if (!tenant || working) return;
    if (!window.confirm(`End "${s.sponsor_name}" now?`)) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await adminEndSponsor(tenant.id, s.id);
      setNotice(`"${s.sponsor_name}" ended.`);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to end the placement.');
    } finally {
      setWorking(false);
    }
  };

  const handleDelete = async (s: AdminSponsor) => {
    if (!tenant || working) return;
    if (!window.confirm(`Delete "${s.sponsor_name}"? This cannot be undone.`)) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await adminDeleteSponsor(tenant.id, s.id);
      setNotice('Sponsor placement deleted.');
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to delete the placement.');
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

      <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Handshake size={22} /> Sponsor Messages
      </h1>
      <p style={{ margin: '4px 0 20px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Assign a member business to a route as a quiet "Brought to you by" credit. Once per visit, easily dismissed, never an ad unit.
      </p>

      {/* Feature toggle - the most obvious thing on the page, per Jim's requirement 2 */}
      <div className="card" style={{
        marginBottom: 20, padding: 16, background: 'var(--white)',
        borderLeft: `4px solid ${featureOn ? 'var(--green)' : 'var(--muted)'}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
              Sponsor drawer is {featureOn ? 'ON' : 'OFF'}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
              When off, no sponsor messages appear anywhere in the Hub.
            </p>
          </div>
          <button
            className={featureOn ? 'btn btn-secondary btn-sm' : 'btn btn-amber btn-sm'}
            onClick={toggleFeature}
            disabled={working}
            style={{ minHeight: 36 }}
          >
            {featureOn ? 'Turn Off' : 'Turn On'}
          </button>
        </div>
      </div>

      {/* Independent toggle - piloting inline banners must not require touching whether the Drawer is live anywhere */}
      <div className="card" style={{
        marginBottom: 20, padding: 16, background: 'var(--white)',
        borderLeft: `4px solid ${inlineFeatureOn ? 'var(--green)' : 'var(--muted)'}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
              Inline banners are {inlineFeatureOn ? 'ON' : 'OFF'}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
              Static image placements (Top/Footer/Feed/Story banners). Independent of the drawer toggle above.
            </p>
          </div>
          <button
            className={inlineFeatureOn ? 'btn btn-secondary btn-sm' : 'btn btn-amber btn-sm'}
            onClick={toggleInlineFeature}
            disabled={working}
            style={{ minHeight: 36 }}
          >
            {inlineFeatureOn ? 'Turn Off' : 'Turn On'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
          Placements ({sponsors.length})
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchAll} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={openCreate} className="btn btn-amber btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
            <Plus size={14} /> New Placement
          </button>
        </div>
      </div>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {notice && <Alert type="success" style={{ marginBottom: 16 }}>{notice}</Alert>}

      {showForm && (
        <div ref={formRef} className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', color: 'var(--green)' }}>
            {editingId ? 'Edit Placement' : 'New Placement'}
          </h3>

          <div className="form-grid-2" style={{ marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>App</label>
              <select className="form-select" style={inputStyle} value={form.app}
                onChange={e => {
                  const app = e.target.value as SponsorApp;
                  setForm(f => ({ ...f, app, route: SPONSOR_ROUTES_BY_APP[app][0].value }));
                }}>
                {SPONSOR_APPS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Where does it appear?</label>
              <select className="form-select" style={inputStyle} value={form.placement}
                onChange={e => {
                  const placement = e.target.value as SponsorPlacementType;
                  const isInline = INLINE_PLACEMENTS.has(placement);
                  setForm(f => ({ ...f, placement, banner_size: isInline ? (f.banner_size ?? SPONSOR_BANNER_SIZES[0].value) : null }));
                }}>
                {SPONSOR_PLACEMENTS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          {INLINE_PLACEMENTS.has(form.placement) && (
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Banner size</label>
              <select className="form-select" style={inputStyle} value={form.banner_size ?? SPONSOR_BANNER_SIZES[0].value}
                onChange={e => setForm(f => ({ ...f, banner_size: e.target.value as any }))}>
                {SPONSOR_BANNER_SIZES.map(s => <option key={s.value} value={s.value}>{s.label} - {s.dims}</option>)}
              </select>
              <p style={{ margin: '6px 0 0', fontSize: '0.74rem', color: 'var(--muted)' }}>
                {SPONSOR_BANNER_SIZES.find(s => s.value === (form.banner_size ?? SPONSOR_BANNER_SIZES[0].value))?.guidance}
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer', marginTop: 10 }}>
                <input type="checkbox" checked={form.show_credit_line}
                  onChange={e => setForm(f => ({ ...f, show_credit_line: e.target.checked }))} />
                Show "Brought to you by" credit line
              </label>
              <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: 'var(--muted)' }}>
                Turn this off if the sponsor's image already makes the sponsorship obvious - leave it on otherwise.
              </p>
            </div>
          )}

          <div className="form-grid-2">
            <div>
              <label style={labelStyle}>Sponsor name ({form.sponsor_name.length}/60)</label>
              <input className="form-input" style={inputStyle} value={form.sponsor_name} maxLength={60}
                placeholder="e.g. Lakeside Hardware"
                onChange={e => setForm(f => ({ ...f, sponsor_name: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Route</label>
              <select className="form-select" style={inputStyle} value={form.route}
                onChange={e => setForm(f => ({ ...f, route: e.target.value }))}>
                <option value="*">All routes</option>
                {SPONSOR_ROUTES_BY_APP[form.app].map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Message ({form.message.length}/120)</label>
            <input className="form-input" style={inputStyle} value={form.message} maxLength={120}
              placeholder="One short line about what they offer members"
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Where does it show?</label>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', minHeight: 36, alignItems: 'center' }}>
              {(['region', 'city', 'zip'] as SponsorTargetKind[]).map(kind => (
                <label key={kind} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input type="radio" name="target_kind" checked={form.target_kind === kind}
                    onChange={() => setForm(f => ({ ...f, target_kind: kind, target_value: '' }))} />
                  {kind === 'region' ? 'Everyone' : kind === 'city' ? 'One town' : 'One ZIP code'}
                </label>
              ))}
            </div>
            {form.target_kind === 'city' && (
              <input className="form-input" style={{ ...inputStyle, marginTop: 8 }} value={form.target_value}
                placeholder="Coldwater, MI"
                onChange={e => setForm(f => ({ ...f, target_value: e.target.value }))} />
            )}
            {form.target_kind === 'zip' && (
              <input className="form-input" style={{ ...inputStyle, marginTop: 8 }} value={form.target_value}
                placeholder="49036" maxLength={5}
                onChange={e => setForm(f => ({ ...f, target_value: e.target.value.replace(/\D/g, '').slice(0, 5) }))} />
            )}
            <p style={{ margin: '6px 0 0', fontSize: '0.74rem', color: 'var(--muted)' }}>
              City and ZIP targeting reaches signed-in members who have set a home town.
            </p>
          </div>

          <div className="form-grid-2">
            <div>
              <label style={labelStyle}>Starts (optional - default now)</label>
              <input type="datetime-local" className="form-input" style={inputStyle} value={form.starts_at}
                onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Ends (optional - open-ended)</label>
              <input type="datetime-local" className="form-input" style={inputStyle} value={form.ends_at}
                onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))} />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Link (optional - a page in the Hub)</label>
            <input className="form-input" style={inputStyle} value={form.link_url}
              placeholder="/deals or https://lakeandlocals.com/..."
              onChange={e => setForm(f => ({ ...f, link_url: e.target.value }))} />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Photo (optional)</label>
            <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--muted)' }}>
              {INLINE_PLACEMENTS.has(form.placement)
                ? `${SPONSOR_BANNER_SIZES.find(s => s.value === (form.banner_size ?? SPONSOR_BANNER_SIZES[0].value))?.dims} works best. ${SPONSOR_BANNER_SIZES.find(s => s.value === (form.banner_size ?? SPONSOR_BANNER_SIZES[0].value))?.guidance}`
                : 'Square works best, logo or subject centered - it renders small (about 130px) and gets cropped to fit, so a wide banner photo will lose its edges. Around 600x600px is plenty; no need to send anything larger.'}
            </p>
            <input type="file" accept="image/*" disabled={uploading}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
            {uploading && <span style={{ marginLeft: 8, fontSize: '0.78rem', color: 'var(--muted)' }}>Uploading...</span>}
          </div>

          {/* Save/Cancel come before the preview, not after - the preview
              below renders the REAL SponsorDrawer at position:fixed, which
              on mobile pins over the bottom of the screen and would
              otherwise sit on top of these buttons, making them unreachable
              without dismissing it first. */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 20 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)} disabled={working} style={{ minHeight: 34 }}>
              Cancel
            </button>
            <button className="btn btn-amber btn-sm" onClick={handleSubmit} disabled={working} style={{ minHeight: 34 }}>
              {working ? 'Saving...' : editingId ? 'Save Changes' : 'Create Placement'}
            </button>
          </div>

          <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <label style={labelStyle}>Preview</label>
            {INLINE_PLACEMENTS.has(form.placement) ? (
              <>
                <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--muted)' }}>
                  The real component, sized to its actual box - it sits in the page, not pinned to an edge.
                </p>
                <SponsorBanner
                  placement={{
                    id: 0,
                    sponsor_name: form.sponsor_name || 'Sponsor name',
                    message: form.message || 'Sponsor message goes here.',
                    link_url: form.link_url || null,
                    image_url: form.image_url || null,
                    banner_size: form.banner_size ?? SPONSOR_BANNER_SIZES[0].value,
                    show_credit_line: form.show_credit_line,
                  }}
                  onTap={() => {}}
                />
              </>
            ) : (
              <>
                <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--muted)' }}>
                  The real card - it will appear pinned to the bottom of your screen.
                </p>
                {previewDismissed ? (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreviewDismissed(false)}
                    style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Eye size={13} /> Show preview
                  </button>
                ) : (
                  <SponsorDrawer
                    placement={{
                      id: 0,
                      sponsor_name: form.sponsor_name || 'Sponsor name',
                      message: form.message || 'Sponsor message goes here.',
                      link_url: form.link_url || null,
                      image_url: form.image_url || null,
                    }}
                    onDismiss={() => setPreviewDismissed(true)}
                    onTap={() => {}}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sponsors.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)' }}>No sponsor placements yet.</p>
          </div>
        ) : (
          sponsors.map(s => (
            <div key={s.id} className="card" style={{ background: 'var(--white)', padding: 16, borderLeft: `4px solid ${STATE_COLOR[s.state]}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--green)', fontWeight: 600 }}>{s.sponsor_name}</h3>
                    <span style={{ fontSize: '0.66rem', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 'var(--r-sm)', background: 'rgba(30,51,32,0.12)', color: 'var(--green)', fontWeight: 700 }}>
                      {appLabel(s.app)}
                    </span>
                    <span style={{ fontSize: '0.66rem', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 'var(--r-sm)', background: 'rgba(80,120,80,0.12)', color: 'var(--green)' }}>
                      {routeLabel(s.app, s.route)}
                    </span>
                    <span style={{ fontSize: '0.66rem', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 'var(--r-sm)', background: 'rgba(30,51,32,0.08)', color: 'var(--green)' }}>
                      {placementLabel(s.placement)}
                    </span>
                    <span style={{ fontSize: '0.66rem', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 'var(--r-sm)', background: 'rgba(200,134,10,0.12)', color: 'var(--amber)' }}>
                      {targetChip(s)}
                    </span>
                  </div>
                  <p style={{ margin: '0 0 4px', fontSize: '0.78rem', color: 'var(--text)' }}>{s.message}</p>
                  <p style={{ margin: 0, fontSize: '0.74rem', color: STATE_COLOR[s.state] }}>{s.state_note}</p>
                  <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: 'var(--muted)' }}>
                    {s.impressions.recent_shows.toLocaleString()} shows &middot; {s.impressions.recent_taps.toLocaleString()} taps &middot; last 7 days
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignSelf: 'center' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(s)}
                    style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Pencil size={13} /> Edit
                  </button>
                  {s.state === 'ended' ? (
                    <button className="btn btn-amber btn-sm" onClick={() => openRelist(s)}
                      style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <RefreshCw size={13} /> Run it again
                    </button>
                  ) : s.is_active ? (
                    <button className="btn btn-secondary btn-sm" onClick={() => setActive(s, false)} disabled={working}
                      style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <PauseCircle size={13} /> Pause
                    </button>
                  ) : (
                    <button className="btn btn-amber btn-sm" onClick={() => setActive(s, true)} disabled={working}
                      style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <CheckCircle size={13} /> Resume
                    </button>
                  )}
                  {s.state !== 'ended' && (
                    <button className="btn btn-secondary btn-sm" onClick={() => endNow(s)} disabled={working}
                      style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Square size={13} /> End now
                    </button>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(s)} disabled={working}
                    style={{ minHeight: 32, borderColor: 'var(--error)', color: 'var(--error)' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
