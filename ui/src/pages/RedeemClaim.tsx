import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { lookupClaim, confirmClaim, type ClaimLookup } from '../api/redeem';
import { ArrowLeft, Search, CheckCircle, XCircle, Clock, Gift, RotateCcw } from 'lucide-react';
import { Alert } from '../components/ui/Alert';

export default function RedeemClaim() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [code, setCode] = useState('');
  const [claim, setClaim] = useState<ClaimLookup | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [redeemed, setRedeemed] = useState(false);

  const canRedeem = !!user && (user.is_admin || (user.business_id && user.business_status === 'verified'));

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!canRedeem) { navigate('/profile'); }
  }, [user]);

  const handleLookup = async () => {
    if (!tenant || working || !code.trim()) return;
    setWorking(true);
    setError('');
    setClaim(null);
    setRedeemed(false);
    try {
      const res = await lookupClaim(tenant.id, code.trim());
      setClaim(res.data);
    } catch (err: any) {
      setError(err.message || 'Lookup failed.');
    } finally {
      setWorking(false);
    }
  };

  const handleConfirm = async () => {
    if (!tenant || working || !claim) return;
    setWorking(true);
    setError('');
    try {
      const res = await confirmClaim(tenant.id, code.trim());
      setClaim(res.data);
      setRedeemed(true);
    } catch (err: any) {
      setError(err.message || 'Redemption failed.');
    } finally {
      setWorking(false);
    }
  };

  const reset = () => {
    setCode('');
    setClaim(null);
    setError('');
    setRedeemed(false);
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { color: string; bg: string; icon: JSX.Element; label: string }> = {
      pending: { color: 'var(--amber)', bg: 'rgba(200,134,10,0.1)', icon: <Clock size={12} />, label: 'Ready to redeem' },
      claimed: { color: 'var(--green)', bg: 'rgba(30,51,32,0.08)', icon: <CheckCircle size={12} />, label: 'Redeemed' },
      expired: { color: 'var(--error)', bg: 'rgba(176,0,0,0.08)', icon: <XCircle size={12} />, label: 'Expired' },
    };
    const s = map[status] ?? map.pending;
    return (
      <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 'var(--r-sm)', background: s.bg, color: s.color, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        {s.icon} {s.label}
      </span>
    );
  };

  return (
    <div className="main-content" style={{ maxWidth: 520, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        Redeem a Prize Claim
      </h1>
      <p style={{ margin: '0 0 20px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Ask the winner for their claim code (it looks like LL-AB12CD34), look it up,
        hand over the prize, and mark it redeemed. Each code works exactly once.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="form-input"
            style={{ margin: 0, minHeight: 44, fontSize: '1.05rem', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'monospace' }}
            placeholder="LL-XXXXXXXX"
            value={code}
            autoFocus
            onChange={e => setCode(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') handleLookup(); }}
          />
          <button className="btn btn-amber" onClick={handleLookup} disabled={working || !code.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, whiteSpace: 'nowrap' }}>
            <Search size={16} /> {working && !claim ? 'Looking up...' : 'Look Up'}
          </button>
        </div>
      </div>

      {claim && (
        <div className="card" style={{
          padding: 24, background: 'var(--white)', textAlign: 'center',
          borderTop: `4px solid ${redeemed || claim.status === 'claimed' ? 'var(--green)' : claim.status === 'expired' ? 'var(--error)' : 'var(--amber)'}`,
        }}>
          <div style={{ marginBottom: 12 }}>{statusBadge(claim.status)}</div>

          <Gift size={32} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <h2 style={{ margin: '0 0 4px', fontSize: '1.35rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
            {claim.prize.name}
          </h2>
          {claim.prize.details && (
            <p style={{ margin: '0 0 8px', fontSize: '0.85rem', color: 'var(--text)' }}>{claim.prize.details}</p>
          )}
          <p style={{ margin: '0 0 16px', fontSize: '0.78rem', color: 'var(--muted)' }}>
            Won at {claim.plaque_name} ({claim.location_name}) on {new Date(claim.created_at * 1000).toLocaleString()}
            {claim.contact_info && <> &middot; Contact: {claim.contact_info}</>}
          </p>

          {redeemed ? (
            <Alert type="success" style={{ marginBottom: 16, textAlign: 'left' }}>
              Redeemed! This code is now used and can't be claimed again.
            </Alert>
          ) : claim.redeemable ? (
            <button className="btn btn-amber" onClick={handleConfirm} disabled={working}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 48, fontSize: '1rem', width: '100%', justifyContent: 'center', marginBottom: 12 }}>
              <CheckCircle size={18} /> {working ? 'Redeeming...' : 'Mark as Redeemed'}
            </button>
          ) : (
            <Alert type="error" style={{ marginBottom: 16, textAlign: 'left' }}>
              {claim.status === 'claimed'
                ? 'This claim was already redeemed - do not hand out the prize again.'
                : 'This claim expired before it was redeemed.'}
            </Alert>
          )}

          <button className="btn btn-secondary btn-sm" onClick={reset}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
            <RotateCcw size={14} /> Redeem Another
          </button>
        </div>
      )}
    </div>
  );
}
