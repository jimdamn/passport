import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import {
  getDeals, purchaseDeal, getMyDealClaims, regenerateClaimCode, claimWindowLabel,
  type Deal, type MyDealClaim, type DealPurchase,
} from '../api/deals';
import { getBalanceOnly } from '../api/credits';
import { Flame, Clock, Coins, Store, CheckCircle, XCircle, RotateCw, Ticket, Tag } from 'lucide-react';
import { Alert } from '../components/ui/Alert';
import { Spinner } from '../components/ui/Spinner';

function useNow(tickMs = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  return now;
}

// Client-side countdown — counts down from the expiry timestamp locally, so
// no server polling is ever needed.
function formatRemaining(seconds: number): string {
  if (seconds <= 0) return 'Expired';
  if (seconds >= 86400 * 2) return `${Math.floor(seconds / 86400)} days left`;
  if (seconds >= 86400) return `1 day ${Math.floor((seconds % 86400) / 3600)} hr left`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} left`;
  return `${m}:${String(s).padStart(2, '0')} left`;
}

function CodeModal({ title, code, expiresAt, onClose }: { title: string; code: string; expiresAt: number; onClose: () => void }) {
  const now = useNow();
  const remaining = expiresAt - now;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(30,51,32,0.55)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div className="card" style={{ background: 'var(--white)', padding: 28, maxWidth: 380, width: '100%', textAlign: 'center' }}
        onClick={e => e.stopPropagation()}>
        <Ticket size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
        <h2 style={{ margin: '0 0 4px', fontSize: '1.15rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>{title}</h2>
        <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--muted)' }}>
          Show this code at the counter. The merchant will verify and redeem it.
        </p>
        <div style={{
          fontSize: '1.6rem', fontWeight: 700, letterSpacing: 2, fontFamily: 'monospace',
          background: 'var(--cream, #f4f1ea)', border: '2px dashed var(--amber)',
          borderRadius: 'var(--r-md, 8px)', padding: '14px 10px', marginBottom: 12, color: 'var(--green)',
          userSelect: 'all',
        }}>
          {code}
        </div>
        <p style={{ margin: '0 0 16px', fontSize: '0.82rem', fontWeight: 600, color: remaining < 3600 ? 'var(--error)' : 'var(--amber)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Clock size={14} /> {formatRemaining(remaining)}
        </p>
        <p style={{ margin: '0 0 16px', fontSize: '0.72rem', color: 'var(--muted)' }}>
          If it expires before you use it, your kredits come right back automatically.
        </p>
        <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ minHeight: 36, width: '100%' }}>Done</button>
      </div>
    </div>
  );
}

export default function Deals() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const now = useNow();

  const [tab, setTab] = useState<'market' | 'mine'>('market');
  const [deals, setDeals] = useState<Deal[]>([]);
  const [mine, setMine] = useState<MyDealClaim[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Deal | null>(null);
  const [showCode, setShowCode] = useState<{ title: string; code: string; expiresAt: number } | null>(null);

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const requests: Promise<any>[] = [getDeals(tenant.id)];
        if (user) {
          requests.push(getMyDealClaims(tenant.id).catch(() => ({ data: [] })));
          requests.push(getBalanceOnly(tenant.id).catch(() => ({ data: { balance: null } })));
        }
        const [dealsRes, mineRes, balRes] = await Promise.all(requests);
        setDeals(dealsRes.data || []);
        if (mineRes) setMine(mineRes.data || []);
        if (balRes?.data?.balance !== undefined) setBalance(balRes.data.balance);
      } catch (err: any) {
        setError(err.message || 'Failed to load deals.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, user]);

  const refreshAfterPurchase = async () => {
    if (!tenant) return;
    try {
      const [dealsRes, mineRes, balRes] = await Promise.all([
        getDeals(tenant.id),
        getMyDealClaims(tenant.id),
        getBalanceOnly(tenant.id),
      ]);
      setDeals(dealsRes.data || []);
      setMine(mineRes.data || []);
      setBalance(balRes.data.balance);
    } catch { /* refresh is best-effort; the purchase already succeeded */ }
  };

  const handlePurchase = async (deal: Deal) => {
    if (!tenant || working) return;
    setWorking(deal.id);
    setError('');
    try {
      const res = await purchaseDeal(tenant.id, deal.id);
      const p: DealPurchase = res.data;
      setConfirming(null);
      setShowCode({ title: p.deal_title, code: p.claim_code, expiresAt: p.expires_at });
      await refreshAfterPurchase();
    } catch (err: any) {
      setConfirming(null);
      setError(err.message || 'Purchase failed.');
    } finally {
      setWorking(null);
    }
  };

  const handleShowCode = async (claim: MyDealClaim) => {
    if (!tenant || working) return;
    setWorking(claim.id);
    setError('');
    try {
      const res = await regenerateClaimCode(tenant.id, claim.id);
      setShowCode({ title: claim.deal_title, code: res.data.claim_code, expiresAt: res.data.expires_at });
    } catch (err: any) {
      setError(err.message || 'Could not load your code.');
    } finally {
      setWorking(null);
    }
  };

  const pendingMine = useMemo(() => mine.filter(m => m.status === 'pending' && m.expires_at > now), [mine, now]);

  if (loading) {
    return (
      <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}>
        <Spinner size="lg" />
        <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: '0.85rem' }}>Loading deals...</p>
      </div>
    );
  }

  const claimStatusBadge = (cl: MyDealClaim) => {
    const expired = cl.status === 'refunded' || (cl.status === 'pending' && cl.expires_at <= now);
    if (cl.status === 'claimed') return <span style={{ color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 600 }}><CheckCircle size={11} /> Redeemed</span>;
    if (expired) return <span style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 600 }}><XCircle size={11} /> Expired — kredits returned</span>;
    return <span style={{ color: cl.expires_at - now < 3600 ? 'var(--error)' : 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 600 }}><Clock size={11} /> {formatRemaining(cl.expires_at - now)}</span>;
  };

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tag size={22} /> Deals
        </h1>
        {user && balance !== null && (
          <span className="credits-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 700 }}>
            <Coins size={15} /> {balance} kredits
          </span>
        )}
      </div>
      <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Spend your KrowdKredits on real deals at local businesses. Hot deals move fast —
        claim one and use it before the clock runs out.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      {user && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {([['market', 'Marketplace'], ['mine', `My Deals${pendingMine.length ? ` (${pendingMine.length})` : ''}`]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`btn btn-sm ${tab === key ? 'btn-amber' : 'btn-secondary'}`}
              style={{ minHeight: 34 }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === 'market' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {deals.length === 0 ? (
            <div className="card" style={{ padding: 32, textAlign: 'center', background: 'var(--white)' }}>
              <Tag size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
                No deals available right now — check back soon. Local businesses post
                new deals here, and hot deals can appear any time.
              </p>
            </div>
          ) : (
            deals.map(deal => {
              const isHot = deal.is_hot_deal === 1;
              const endsSoon = deal.ends_at !== null && deal.ends_at - now < 86400;
              const canAfford = balance === null || balance >= deal.kredit_price;
              return (
                <div key={deal.id} className="card" style={{
                  background: 'var(--white)', padding: 16,
                  borderLeft: `4px solid ${isHot ? 'var(--error, #c0392b)' : 'var(--green)'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                        {isHot && (
                          <span style={{
                            fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px',
                            borderRadius: 'var(--r-sm)', background: 'rgba(192,57,43,0.1)', color: 'var(--error, #c0392b)',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}>
                            <Flame size={11} /> Hot Deal
                          </span>
                        )}
                        <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--green)', fontWeight: 600 }}>{deal.title}</h3>
                      </div>
                      <p style={{ margin: '0 0 4px', fontSize: '0.78rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Store size={12} /> {deal.merchant_name ?? 'Local merchant'}
                      </p>
                      {deal.details && <p style={{ margin: '0 0 6px', fontSize: '0.8rem', color: 'var(--text)' }}>{deal.details}</p>}
                      <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--muted)' }}>
                        {deal.quantity_left === -1 ? 'Unlimited' : `${deal.quantity_left} left`}
                        {' · '}Use within {claimWindowLabel(deal.claim_window_minutes)} of claiming
                        {deal.ends_at !== null && (
                          <span style={{ color: endsSoon ? 'var(--error)' : undefined, fontWeight: endsSoon ? 600 : undefined }}>
                            {' · '}Offer ends {formatRemaining(deal.ends_at - now).toLowerCase().replace(' left', ' from now')}
                          </span>
                        )}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right', alignSelf: 'center' }}>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--amber)', fontFamily: 'var(--font-serif)', marginBottom: 6, whiteSpace: 'nowrap' }}>
                        {deal.kredit_price} <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--muted)' }}>kredits</span>
                      </div>
                      {user ? (
                        <button
                          className="btn btn-amber btn-sm"
                          style={{ minHeight: 34, whiteSpace: 'nowrap' }}
                          disabled={working !== null || !canAfford}
                          onClick={() => setConfirming(deal)}
                        >
                          {canAfford ? 'Get This Deal' : 'Not enough kredits'}
                        </button>
                      ) : (
                        <button className="btn btn-secondary btn-sm" style={{ minHeight: 34, whiteSpace: 'nowrap' }}
                          onClick={() => navigate('/auth/login')}>
                          Log in to claim
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === 'mine' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mine.length === 0 ? (
            <div className="card" style={{ padding: 32, textAlign: 'center', background: 'var(--white)' }}>
              <Ticket size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
                You haven't claimed any deals yet. Grab one from the marketplace —
                your kredits are automatically returned if you don't use it in time.
              </p>
            </div>
          ) : (
            mine.map(cl => {
              const redeemableNow = cl.status === 'pending' && cl.expires_at > now;
              return (
                <div key={cl.id} className="card" style={{ background: 'var(--white)', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <p style={{ margin: '0 0 2px', fontSize: '0.88rem', color: 'var(--text)', fontWeight: 600 }}>
                      {cl.deal_title}
                    </p>
                    <p style={{ margin: '0 0 4px', fontSize: '0.74rem', color: 'var(--muted)' }}>
                      {cl.merchant_name ?? 'Local merchant'} · {cl.kredits_paid} kredits
                    </p>
                    {claimStatusBadge(cl)}
                  </div>
                  {redeemableNow && (
                    <button className="btn btn-amber btn-sm" style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      disabled={working !== null}
                      onClick={() => handleShowCode(cl)}>
                      <RotateCw size={13} /> Show My Code
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Purchase confirmation */}
      {confirming && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(30,51,32,0.55)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }} onClick={() => setConfirming(null)}>
          <div className="card" style={{ background: 'var(--white)', padding: 24, maxWidth: 380, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 8px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
              Claim this deal?
            </h2>
            <p style={{ margin: '0 0 4px', fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)' }}>{confirming.title}</p>
            <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--muted)' }}>
              {confirming.merchant_name ?? 'Local merchant'}
            </p>
            <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--text)' }}>
              This costs <strong>{confirming.kredit_price} kredits</strong> and must be used within{' '}
              <strong>{claimWindowLabel(confirming.claim_window_minutes)}</strong>. Don't make it in time?
              Your kredits come back automatically.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" style={{ minHeight: 36 }} onClick={() => setConfirming(null)} disabled={working !== null}>
                Cancel
              </button>
              <button className="btn btn-amber btn-sm" style={{ minHeight: 36 }} onClick={() => handlePurchase(confirming)} disabled={working !== null}>
                {working ? 'Claiming...' : `Spend ${confirming.kredit_price} Kredits`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCode && (
        <CodeModal title={showCode.title} code={showCode.code} expiresAt={showCode.expiresAt} onClose={() => setShowCode(null)} />
      )}
    </div>
  );
}
