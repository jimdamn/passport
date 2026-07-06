import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../context/AuthContext';
import {
  getShifts, claimShift, cancelMyShift, getMyShifts, checkinUrl,
  type Shift, type MyShift,
} from '../api/lendahand';
import { HeartHandshake, MapPin, CalendarDays, Store, Coins, CheckCircle } from 'lucide-react';
import { Alert } from '../components/ui/Alert';
import { Spinner } from '../components/ui/Spinner';

/**
 * Lend a Hand - volunteer shifts posted by member businesses (served by the
 * Business Hub API; DISSOLUTION-PLAN §1). Claim a spot, show your QR when
 * you arrive, and the organizer's scan sends your KrowdKredit thank-you.
 * Calm by design: no urgency, no countdowns - spots simply show what's left.
 */

function fmtDate(unixSeconds: number): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(unixSeconds * 1000));
}

const MY_STATUS: Record<MyShift['status'], string> = {
  signed_up: 'Signed up',
  confirmed: 'Confirmed',
  no_show: 'Marked no-show',
  cancelled: 'Cancelled',
};

export default function LendAHand() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'shifts' | 'mine'>('shifts');
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [mine, setMine] = useState<MyShift[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    getShifts().then(setShifts).catch(() => setError('Could not load shifts right now.'));
  }, []);

  useEffect(() => {
    if (tab !== 'mine' || !user || mine !== null) return;
    getMyShifts().then(setMine).catch(() => setError('Could not load your shifts.'));
  }, [tab, user, mine]);

  const claim = async (s: Shift) => {
    if (!user) { navigate('/auth/login'); return; }
    setBusy(s.id); setError('');
    try {
      await claimShift(s.id);
      setClaimedIds(prev => new Set(prev).add(s.id));
      setShifts(prev => prev?.map(x => x.id === s.id ? { ...x, spots_filled: x.spots_filled + 1 } : x) ?? null);
      setMine(null); // refetch on next Mine open
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not claim this shift.');
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (m: MyShift) => {
    setBusy(m.id); setError('');
    try {
      await cancelMyShift(m.id);
      setMine(prev => prev?.map(x => x.id === m.id ? { ...x, status: 'cancelled' } : x) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <HeartHandshake size={22} /> Lend a Hand
      </h1>
      <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        A few hours of help for the places that make this region home. Show up,
        get scanned in, and a KrowdKredit thank-you lands in your Passport.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {([['shifts', 'Open shifts'], ['mine', 'My shifts']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`btn btn-sm ${tab === key ? 'btn-amber' : 'btn-secondary'}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <Alert type="error">{error}</Alert>}

      {tab === 'shifts' && (
        <>
          {shifts === null && <div style={{ textAlign: 'center', padding: 40 }}><Spinner /></div>}
          {shifts !== null && shifts.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 32 }}>
              <HeartHandshake size={26} color="var(--amber)" style={{ marginBottom: 8 }} />
              <p style={{ margin: 0, color: 'var(--muted)' }}>
                No open shifts right now. Businesses post them as things come up -
                check back after the weekend.
              </p>
            </div>
          )}
          {shifts?.map((s) => {
            const spotsLeft = Math.max(0, s.spots_total - s.spots_filled);
            const claimed = claimedIds.has(s.id);
            return (
              <div key={s.id} className="card" style={{ marginBottom: 12, padding: '16px 18px' }}>
                <div style={{ fontWeight: 600, color: 'var(--green)', fontSize: '1rem' }}>{s.title}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', margin: '6px 0', fontSize: '0.82rem', color: 'var(--muted)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Store size={14} /> {s.business_name}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CalendarDays size={14} /> {fmtDate(s.event_date)} ({s.duration_hours} hr)</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={14} /> {s.location}</span>
                </div>
                <p style={{ margin: '8px 0', fontSize: '0.88rem', lineHeight: 1.5 }}>{s.description}</p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--green)', fontWeight: 600 }}>
                    <Coins size={15} color="var(--amber)" /> {s.credits_reward} KrowdKredits
                    <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
                      · {spotsLeft} of {s.spots_total} spots open
                    </span>
                  </span>
                  {claimed ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--green)', fontWeight: 600, fontSize: '0.88rem' }}>
                      <CheckCircle size={16} /> You're in - see My shifts
                    </span>
                  ) : (
                    <button
                      className="btn btn-amber btn-sm"
                      disabled={busy === s.id || spotsLeft === 0}
                      onClick={() => claim(s)}
                    >
                      {spotsLeft === 0 ? 'Shift is full' : busy === s.id ? 'Claiming...' : user ? 'Count me in' : 'Sign in to help'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}

      {tab === 'mine' && (
        <>
          {!user && (
            <div className="card" style={{ textAlign: 'center', padding: 32 }}>
              <p style={{ margin: '0 0 12px', color: 'var(--muted)' }}>Sign in to see your shifts.</p>
              <button className="btn btn-amber btn-sm" onClick={() => navigate('/auth/login')}>Sign in</button>
            </div>
          )}
          {user && mine === null && <div style={{ textAlign: 'center', padding: 40 }}><Spinner /></div>}
          {user && mine !== null && mine.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 32 }}>
              <p style={{ margin: 0, color: 'var(--muted)' }}>
                Nothing yet - claim a shift under Open shifts and it will show up here.
              </p>
            </div>
          )}
          {user && mine?.map((m) => (
            <div key={m.id} className="card" style={{ marginBottom: 12, padding: '16px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 600, color: 'var(--green)' }}>{m.title}</div>
                <span className="btn btn-sm btn-secondary" style={{ pointerEvents: 'none', minHeight: 26 }}>
                  {MY_STATUS[m.status]}{m.status === 'confirmed' ? ` · +${m.credits_awarded}` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', margin: '6px 0', fontSize: '0.82rem', color: 'var(--muted)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Store size={14} /> {m.business_name}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CalendarDays size={14} /> {fmtDate(m.event_date)}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={14} /> {m.location}</span>
              </div>
              {m.status === 'signed_up' && (
                <>
                  <div style={{ textAlign: 'center', margin: '14px 0' }}>
                    <div style={{ display: 'inline-block', background: '#fff', padding: 12, borderRadius: 8, border: '1px solid var(--border, #e2ddd2)' }}>
                      <QRCodeSVG value={checkinUrl(m.confirm_token)} size={160} level="M" />
                    </div>
                    <p style={{ margin: '8px 0 0', fontWeight: 600, fontSize: '0.88rem' }}>
                      Show this when you arrive - the organizer scans it and your thank-you lands.
                    </p>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={busy === m.id}
                    onClick={() => cancel(m)}
                  >
                    {busy === m.id ? 'Cancelling...' : "Can't make it - give up my spot"}
                  </button>
                </>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
