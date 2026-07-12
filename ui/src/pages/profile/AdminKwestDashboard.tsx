import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import {
  getAdminKwestDashboard, runAdminKwestHealthCheck, lookupAdminKwestPlayer, getAdminKwestClaims, updateAdminKwestClaim,
  type DashboardData, type PlayerLookupResult, type ClaimRow,
} from '../../api/adminKwest';
import { ArrowLeft, Activity, Search, ShieldCheck, RefreshCw } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';

const CLAIM_STATUSES = ['pending', 'contacted', 'id_verified', 'paid', 'rejected', 'forfeited'];

export default function AdminKwestDashboard() {
  const { id } = useParams<{ id: string }>();
  const huntId = Number(id);
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [data, setData] = useState<DashboardData | null>(null);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);

  const [healthResult, setHealthResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupResult, setLookupResult] = useState<PlayerLookupResult | null>(null);
  const [claimNotes, setClaimNotes] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) { navigate('/profile'); return; }
    if (tenant.id && huntId) fetchAll();
  }, [user, tenant.id, huntId]);

  const fetchAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [dashRes, claimsRes] = await Promise.all([getAdminKwestDashboard(tenant.id, huntId), getAdminKwestClaims(tenant.id, huntId)]);
      setData(dashRes.data);
      setClaims(claimsRes.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load the dashboard.');
    } finally {
      setLoading(false);
    }
  };

  const handleHealthCheck = async () => {
    if (working) return;
    setWorking(true); setError(''); setHealthResult(null);
    try {
      const res = await runAdminKwestHealthCheck(tenant.id, huntId);
      setHealthResult({ ok: res.data.ok, message: res.data.message });
      if (!res.data.ok && res.data.reason === 'no_test_run') setError('Start a test run from the hunt editor first.');
    } catch (err: any) {
      setError(err.message || 'Health check failed.');
    } finally {
      setWorking(false);
    }
  };

  const handleLookup = async () => {
    if (!lookupEmail || working) return;
    setWorking(true); setError(''); setLookupResult(null);
    try {
      const res = await lookupAdminKwestPlayer(tenant.id, huntId, lookupEmail);
      setLookupResult(res.data);
    } catch (err: any) {
      setError(err.message || 'Lookup failed.');
    } finally {
      setWorking(false);
    }
  };

  const handleClaimStatus = async (claim: ClaimRow, status: string) => {
    if (!claim.claim_id || working) return;
    setWorking(true); setError(''); setNotice('');
    try {
      await updateAdminKwestClaim(tenant.id, claim.claim_id, { status, id_check_note: claimNotes[claim.claim_id] });
      setNotice(`Claim for rank ${claim.finish_rank} updated to ${status}.`);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to update the claim.');
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}><Spinner size="lg" /></div>;
  }
  if (!data) {
    return <div className="main-content" style={{ paddingTop: 24 }}><Alert type="error">{error || 'Could not load this hunt.'}</Alert></div>;
  }

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to={`/profile/admin/kwest/${huntId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Hunt
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={20} style={{ color: 'var(--amber)' }} /> Dashboard
        </h1>
        <button onClick={fetchAll} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {notice && <Alert type="success" style={{ marginBottom: 16 }}>{notice}</Alert>}

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        {[
          ['Players started', data.players_started],
          ['Reveals / hour', data.reveals_last_hour],
          ['Budget spent', `${data.budget_spent} / ${data.budget_cap}`],
          ['Finishes', data.finishes.length],
        ].map(([label, value]) => (
          <div key={label as string} className="card" style={{ background: 'var(--white)', padding: '12px 14px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 2px', fontSize: '1.3rem', fontWeight: 700, color: 'var(--green)' }}>{value}</p>
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--muted)' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Health check */}
      <div className="card" style={{ padding: 16, background: 'var(--white)', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: '0.88rem', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldCheck size={16} style={{ color: 'var(--amber)' }} /> One-tap health check
          </p>
          <button className="btn btn-secondary btn-sm" style={{ minHeight: 32 }} disabled={working} onClick={handleHealthCheck}>Run live check</button>
        </div>
        {healthResult && (
          <p style={{ margin: '10px 0 0', fontSize: '0.82rem', color: healthResult.ok ? 'var(--green)' : 'var(--amber)' }}>
            {healthResult.ok ? 'Routing, DB, and geo math all checked out.' : (healthResult.message || 'Check failed.')}
          </p>
        )}
      </div>

      {/* Per-step funnel */}
      <p className="section-title">Per-step reveal ratio</p>
      <div className="card" style={{ background: 'var(--white)', overflow: 'auto', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Step</th>
              <th style={{ textAlign: 'right', padding: '8px 12px' }}>Hits</th>
              <th style={{ textAlign: 'right', padding: '8px 12px' }}>Near</th>
              <th style={{ textAlign: 'right', padding: '8px 12px' }}>Miss</th>
              <th style={{ textAlign: 'right', padding: '8px 12px' }}>Avg accuracy</th>
            </tr>
          </thead>
          <tbody>
            {data.per_step.map(s => (
              <tr key={s.step_id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 12px' }}>{s.seq}</td>
                <td style={{ textAlign: 'right', padding: '8px 12px' }}>{s.hits}</td>
                <td style={{ textAlign: 'right', padding: '8px 12px' }}>{s.nears}</td>
                <td style={{ textAlign: 'right', padding: '8px 12px' }}>{s.misses}</td>
                <td style={{ textAlign: 'right', padding: '8px 12px' }}>{s.avg_accuracy_m != null ? `${Math.round(s.avg_accuracy_m)}m` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Player lookup */}
      <p className="section-title">Player lookup</p>
      <div className="card" style={{ padding: 16, background: 'var(--white)', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input className="form-input" style={{ minHeight: 36, margin: 0, flex: 1 }} placeholder="player@email.com" value={lookupEmail} onChange={e => setLookupEmail(e.target.value)} />
          <button className="btn btn-amber btn-sm" style={{ minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 6 }} disabled={working} onClick={handleLookup}>
            <Search size={13} /> Look up
          </button>
        </div>
        {lookupResult && !lookupResult.found && <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>No player found with that email.</p>}
        {lookupResult?.found && (
          <div style={{ fontSize: '0.82rem' }}>
            <p style={{ margin: '0 0 8px' }}>
              Current step: {lookupResult.progress?.current_seq ?? '-'} · {lookupResult.progress?.finished_at ? 'Finished' : 'In progress'}
              {lookupResult.progress?.is_test ? ' (test run)' : ''}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>Step</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>Result</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px' }}>Accuracy</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px' }}>Distance</th>
                    <th style={{ textAlign: 'center', padding: '6px 8px' }}>Sim</th>
                  </tr>
                </thead>
                <tbody>
                  {(lookupResult.reveals ?? []).map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px' }}>{r.seq}</td>
                      <td style={{ padding: '6px 8px' }}>{r.result}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>{r.accuracy_m != null ? `${Math.round(r.accuracy_m)}m` : '-'}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>{Math.round(r.distance_m)}m</td>
                      <td style={{ textAlign: 'center', padding: '6px 8px' }}>{r.sim ? 'yes' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: '0.74rem', color: 'var(--muted)' }}>
              Far + accurate = wrong spot. Close + rejected = check the radius. Accuracy in the hundreds = device GPS trouble.
            </p>
          </div>
        )}
      </div>

      {/* Claims review */}
      <p className="section-title">Claims review</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {claims.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>No finishes yet.</p>
          </div>
        ) : (
          claims.map(claim => (
            <div key={claim.finish_rank} className="card" style={{ background: 'var(--white)', padding: 14 }}>
              <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: '0.88rem', color: 'var(--green)' }}>
                Rank {claim.finish_rank} · {claim.display_name_snapshot} · {claim.prize_kind}
              </p>
              {claim.claim_id ? (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <select className="form-select" style={{ minHeight: 32, margin: 0 }} value={claim.claim_status ?? 'pending'}
                      onChange={e => handleClaimStatus(claim, e.target.value)} disabled={working}>
                      {CLAIM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <input className="form-input" style={{ minHeight: 32, margin: 0, flex: 1, minWidth: 200 }}
                      placeholder="ID verified, DOB confirms 18+"
                      defaultValue={claim.id_check_note ?? ''}
                      onChange={e => setClaimNotes(n => ({ ...n, [claim.claim_id as number]: e.target.value }))} />
                  </div>
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--muted)' }}>
                    {claim.reviewer ? `Last reviewed by ${claim.reviewer}` : 'Not yet reviewed'}
                  </p>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)' }}>No claim required for this tier - awarded automatically.</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
