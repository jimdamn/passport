import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { getAdminKwestSteps, recordAdminKwestFieldTest, type AdminKwestStep } from '../../api/adminKwest';
import { ArrowLeft, LocateFixed, CheckCircle2, XCircle } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';

// Haversine, meters - mirrors src/lib/geo.ts server-side. Admin-only screen,
// so showing the live distance to the (visible-to-admin) target is fine.
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function AdminKwestFieldTest() {
  const { id } = useParams<{ id: string }>();
  const huntId = Number(id);
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [steps, setSteps] = useState<AdminKwestStep[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);

  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [geoError, setGeoError] = useState('');
  const watchStarted = useRef<number | null>(null);
  const fixSeconds = useRef<number | null>(null);

  const [note, setNote] = useState('');
  const [publicAccess, setPublicAccess] = useState(false);
  const [safe, setSafe] = useState(false);

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) { navigate('/profile'); return; }
    if (!tenant.id || !huntId) return;
    getAdminKwestSteps(tenant.id, huntId)
      .then(res => {
        setSteps(res.data || []);
        const fromQuery = Number(searchParams.get('step'));
        setSelectedStepId(fromQuery || res.data?.[0]?.id || null);
      })
      .catch(err => setError(err.message || 'Failed to load steps.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenant.id, huntId]);

  useEffect(() => {
    if (!navigator.geolocation) { setGeoError('This device has no location support.'); return; }
    watchStarted.current = Date.now();
    fixSeconds.current = null;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (fixSeconds.current === null && watchStarted.current) {
          fixSeconds.current = (Date.now() - watchStarted.current) / 1000;
        }
        setPosition(pos);
        setGeoError('');
      },
      (err) => setGeoError(err.message || 'Could not read your location.'),
      { enableHighAccuracy: true, maximumAge: 0 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [selectedStepId]);

  const step = steps.find(s => s.id === selectedStepId);
  const distance = step && position ? distanceMeters(position.coords.latitude, position.coords.longitude, step.target_lat, step.target_lng) : null;
  const pass = step && distance !== null ? distance <= step.radius_m : null;

  const handleRecord = async () => {
    if (!step || !position || working) return;
    if (!publicAccess || !safe) { setError('Confirm both safety checklist items before recording.'); return; }
    setWorking(true); setError(''); setNotice('');
    try {
      await recordAdminKwestFieldTest(tenant.id, step.id, {
        accuracy_m_observed: Math.round(position.coords.accuracy),
        fix_seconds: Math.round((fixSeconds.current ?? 0) * 10) / 10,
        note,
        public_access: publicAccess,
        safe,
      });
      setNotice(`Field test recorded for step ${step.seq}.`);
      const res = await getAdminKwestSteps(tenant.id, huntId);
      setSteps(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to record the field test.');
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}><Spinner size="lg" /></div>;
  }

  return (
    <div className="main-content" style={{ maxWidth: 480, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to={`/profile/admin/kwest/${huntId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Hunt
      </Link>

      <h1 style={{ margin: '0 0 16px', fontSize: '1.3rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <LocateFixed size={20} style={{ color: 'var(--amber)' }} /> Field Test
      </h1>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {notice && <Alert type="success" style={{ marginBottom: 16 }}>{notice}</Alert>}
      {geoError && <Alert type="error" style={{ marginBottom: 16 }}>{geoError}</Alert>}

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>Step</label>
        <select className="form-select" style={{ minHeight: 40, margin: 0, width: '100%' }} value={selectedStepId ?? ''} onChange={e => setSelectedStepId(Number(e.target.value))}>
          {steps.map(s => <option key={s.id} value={s.id}>Step {s.seq}{s.field_tested_at ? ' (already tested)' : ''}</option>)}
        </select>
      </div>

      <div className="card" style={{ padding: 20, background: 'var(--white)', textAlign: 'center', marginBottom: 16 }}>
        {position ? (
          <>
            <p style={{ margin: '0 0 4px', fontSize: '0.75rem', color: 'var(--muted)' }}>Your GPS accuracy</p>
            <p style={{ margin: '0 0 16px', fontSize: '1.3rem', fontWeight: 700, color: 'var(--green)' }}>{Math.round(position.coords.accuracy)}m</p>
            {distance !== null && (
              <>
                <p style={{ margin: '0 0 4px', fontSize: '0.75rem', color: 'var(--muted)' }}>Distance to target</p>
                <p style={{ margin: '0 0 12px', fontSize: '2rem', fontWeight: 700, color: pass ? 'var(--green)' : 'var(--amber)' }}>{Math.round(distance)}m</p>
                <p style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.9rem', fontWeight: 600, color: pass ? 'var(--green)' : 'var(--amber)' }}>
                  {pass ? <CheckCircle2 size={18} /> : <XCircle size={18} />} {pass ? 'Within radius' : `Outside the ${step?.radius_m}m radius`}
                </p>
              </>
            )}
          </>
        ) : (
          <Spinner />
        )}
      </div>

      <div className="card" style={{ padding: 16, background: 'var(--white)', marginBottom: 16 }}>
        <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: '0.88rem', color: 'var(--green)' }}>Safety checklist</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', marginBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={publicAccess} onChange={e => setPublicAccess(e.target.checked)} /> This spot is publicly accessible - no trespassing required
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', marginBottom: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={safe} onChange={e => setSafe(e.target.checked)} /> Safe terrain - no traffic, water, or climbing hazards
        </label>
        <textarea className="form-input" style={{ minHeight: 60, margin: 0, width: '100%' }} placeholder="Notes (optional)" value={note} onChange={e => setNote(e.target.value)} />
      </div>

      <button className="btn btn-amber btn-block" style={{ minHeight: 48 }} disabled={!position || working} onClick={handleRecord}>
        {working ? 'Recording...' : 'Record Field Test'}
      </button>
    </div>
  );
}
