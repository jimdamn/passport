import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  stewardPendingShifts, stewardReviewShift, type PendingShift,
} from '../../api/lendahand';
import { ArrowLeft, HeartHandshake, CheckCircle, XCircle, RefreshCw, Store, MapPin, CalendarDays } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';

/**
 * Volunteer Shift Review - the same admin gatekeeping as Deal Review, for
 * shifts businesses post from the Hub. Approving puts the shift in front of
 * neighbors under Lend a Hand; either decision emails the business. The
 * data and the is_admin check live in kk-business (the module's home);
 * this page is a front door on your normal admin route.
 */

function fmtDate(unixSeconds: number): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(unixSeconds * 1000));
}

export default function AdminVolunteer() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [shifts, setShifts] = useState<PendingShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) { navigate('/profile'); return; }
    fetchShifts();
  }, [user]);

  const fetchShifts = async () => {
    setLoading(true);
    setError('');
    try {
      setShifts(await stewardPendingShifts());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pending shifts.');
    } finally {
      setLoading(false);
    }
  };

  const review = async (s: PendingShift, status: 'active' | 'rejected') => {
    if (working) return;
    let note: string | undefined;
    if (status === 'rejected') {
      const answer = window.prompt(`Not approving "${s.title}". Add a short note for the business (they see it in the email):`);
      if (answer === null) return; // cancelled the prompt
      note = answer;
    }
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await stewardReviewShift(s.id, status, note);
      setNotice(status === 'active'
        ? `"${s.title}" is live under Lend a Hand - the business has been emailed.`
        : `"${s.title}" was declined - the business has been emailed your note.`);
      await fetchShifts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update the shift.');
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

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <HeartHandshake size={22} /> Volunteer Shift Review
        </h1>
        <button onClick={fetchShifts} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Shifts businesses post from the Hub wait here until you approve them. Check
        the KrowdKredit thank-you looks fair for the ask - approving puts the shift
        in front of neighbors under Lend a Hand.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {notice && <Alert type="success" style={{ marginBottom: 16 }}>{notice}</Alert>}

      <h2 style={{ margin: '0 0 12px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--amber)' }}>
        Awaiting Review ({shifts.length})
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {shifts.length === 0 ? (
          <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>Nothing waiting - all caught up.</p>
          </div>
        ) : shifts.map((s) => (
          <div key={s.id} className="card" style={{ background: 'var(--white)', padding: 16, borderLeft: '4px solid var(--amber)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '1rem', color: 'var(--green)', fontWeight: 600 }}>{s.title}</h3>
                <p style={{ margin: '0 0 2px', fontSize: '0.76rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Store size={11} /> {s.business_name}
                </p>
                <p style={{ margin: '0 0 4px', fontSize: '0.78rem', color: 'var(--text)' }}>{s.description}</p>
                <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CalendarDays size={11} /> {fmtDate(s.event_date)} ({s.duration_hours} hr)</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={11} /> {s.location}</span>
                  <span>{s.spots_total} spots · {s.credits_reward} KrowdKredits each</span>
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignSelf: 'center' }}>
                <button className="btn btn-amber btn-sm" onClick={() => review(s, 'active')} disabled={working}
                  style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <CheckCircle size={13} /> Approve &amp; Go Live
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => review(s, 'rejected')} disabled={working}
                  style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 5, borderColor: 'var(--error)', color: 'var(--error)' }}>
                  <XCircle size={13} /> Decline
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
