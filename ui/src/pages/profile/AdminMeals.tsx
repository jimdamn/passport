import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import {
  adminListKitchens, adminListMeals, adminHideKitchen, adminHideMeal,
  type AdminKitchenRow, type AdminMealRow,
} from '../../api/meals';
import { ArrowLeft, UtensilsCrossed, RefreshCw } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';
import { Badge } from '../../components/ui/Badge';

// Community Table's admin moderation page. Any signed-in local can run a
// kitchen here - no organization verification - so this is the only backstop
// against bad actors. Follows AdminPopups.tsx's two-tab (Kitchens/Meals)
// table-in-scroll-container + hide-modal pattern exactly. Hiding is never
// owner-reversible (src/handlers/meals.ts always 403s while admin_hidden is
// set) - only this page's Unhide clears it.

type BadgeVariant = 'green' | 'amber' | 'red' | 'gray';

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function kitchenState(row: AdminKitchenRow): { label: string; variant: BadgeVariant } {
  if (row.deleted_at) return { label: 'Removed', variant: 'gray' };
  if (row.admin_hidden) return { label: 'Hidden by admin', variant: 'red' };
  if (row.is_hidden) return { label: 'Quiet', variant: 'amber' };
  return { label: 'Visible', variant: 'green' };
}

function mealState(row: AdminMealRow, today: string): { label: string; variant: BadgeVariant } {
  if (row.deleted_at) return { label: 'Removed', variant: 'gray' };
  if (row.admin_hidden) return { label: 'Hidden by admin', variant: 'red' };
  if (row.cancelled_at) return { label: 'Cancelled', variant: 'gray' };
  if (row.date < today) return { label: 'Done', variant: 'gray' };
  if (row.sold_out) return { label: 'Sold out', variant: 'amber' };
  return { label: 'Scheduled', variant: 'amber' };
}

type HideTarget =
  | { kind: 'kitchen'; row: AdminKitchenRow }
  | { kind: 'meal'; row: AdminMealRow };

export default function AdminMeals() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [tab, setTab] = useState<'kitchens' | 'meals'>('kitchens');
  const [kitchens, setKitchens] = useState<AdminKitchenRow[]>([]);
  const [meals, setMeals] = useState<AdminMealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const [hideTarget, setHideTarget] = useState<HideTarget | null>(null);
  const [reason, setReason] = useState('');
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) { navigate('/profile'); return; }
    if (tenant) fetchAll();
  }, [user, tenant]);

  async function fetchAll() {
    if (!tenant) return;
    setLoading(true);
    setError('');
    try {
      const [kitchensRes, mealsRes] = await Promise.all([
        adminListKitchens(tenant.id),
        adminListMeals(tenant.id),
      ]);
      setKitchens(kitchensRes.data || []);
      setMeals(mealsRes.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load Community Table.');
    } finally {
      setLoading(false);
    }
  }

  function openHide(target: HideTarget) {
    setHideTarget(target);
    setReason('');
    setModalError('');
  }

  async function confirmHide() {
    if (!tenant || !hideTarget || working) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setModalError(hideTarget.kind === 'kitchen'
        ? "A reason is required when hiding a member's kitchen."
        : "A reason is required when hiding a member's meal.");
      return;
    }
    setWorking(true);
    setModalError('');
    try {
      if (hideTarget.kind === 'kitchen') {
        await adminHideKitchen(tenant.id, hideTarget.row.id, true, trimmed);
      } else {
        await adminHideMeal(tenant.id, hideTarget.row.id, true, trimmed);
      }
      setHideTarget(null);
      setReason('');
      await fetchAll();
    } catch (err: any) {
      setModalError(err.message || 'Failed to hide that.');
    } finally {
      setWorking(false);
    }
  }

  async function unhide(target: HideTarget) {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    try {
      if (target.kind === 'kitchen') {
        await adminHideKitchen(tenant.id, target.row.id, false);
      } else {
        await adminHideMeal(tenant.id, target.row.id, false);
      }
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to unhide that.');
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <UtensilsCrossed size={22} /> Community Table
        </h1>
        <button onClick={fetchAll} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Any signed-in local can run a kitchen here - no organization verification. Hiding requires a
        reason the owner will see word for word, and only an admin can reverse it.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setTab('kitchens')} className={`btn btn-sm ${tab === 'kitchens' ? 'btn-amber' : 'btn-secondary'}`} style={{ minHeight: 32 }}>
          Kitchens ({kitchens.length})
        </button>
        <button onClick={() => setTab('meals')} className={`btn btn-sm ${tab === 'meals' ? 'btn-amber' : 'btn-secondary'}`} style={{ minHeight: 32 }}>
          Meals ({meals.length})
        </button>
      </div>

      {tab === 'kitchens' ? (
        kitchens.length === 0 ? (
          <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>No kitchens yet.</p>
          </div>
        ) : (
          <div className="card" style={{ background: 'var(--white)', overflow: 'auto', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Owner</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>State</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Created</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }} />
                </tr>
              </thead>
              <tbody>
                {kitchens.map(k => {
                  const state = kitchenState(k);
                  return (
                    <tr key={k.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--green)' }}>{k.name}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{k.owner_email ?? '-'}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <Badge variant={state.variant}>{state.label}</Badge>
                        {!!k.admin_hidden && k.admin_hidden_reason && (
                          <div style={{ fontSize: '0.74rem', color: 'var(--error)', marginTop: 4 }}>Reason: {k.admin_hidden_reason}</div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatDate(k.created_at)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {k.admin_hidden ? (
                          <button className="btn btn-amber btn-sm" disabled={working} style={{ minHeight: 32 }}
                            onClick={() => unhide({ kind: 'kitchen', row: k })}>
                            Unhide
                          </button>
                        ) : (
                          <button className="btn btn-danger btn-sm" disabled={working} style={{ minHeight: 32 }}
                            onClick={() => openHide({ kind: 'kitchen', row: k })}>
                            Hide
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        meals.length === 0 ? (
          <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>No meals yet.</p>
          </div>
        ) : (
          <div className="card" style={{ background: 'var(--white)', overflow: 'auto', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Kitchen</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Title</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>State</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Created</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }} />
                </tr>
              </thead>
              <tbody>
                {meals.map(m => {
                  const state = mealState(m, today);
                  return (
                    <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{m.kitchen_name}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--green)' }}>{m.title}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{m.date}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <Badge variant={state.variant}>{state.label}</Badge>
                        {!!m.admin_hidden && m.admin_hidden_reason && (
                          <div style={{ fontSize: '0.74rem', color: 'var(--error)', marginTop: 4 }}>Reason: {m.admin_hidden_reason}</div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatDate(m.created_at)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {m.admin_hidden ? (
                          <button className="btn btn-amber btn-sm" disabled={working} style={{ minHeight: 32 }}
                            onClick={() => unhide({ kind: 'meal', row: m })}>
                            Unhide
                          </button>
                        ) : (
                          <button className="btn btn-danger btn-sm" disabled={working} style={{ minHeight: 32 }}
                            onClick={() => openHide({ kind: 'meal', row: m })}>
                            Hide
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {hideTarget && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setHideTarget(null)}
        >
          <div className="card" style={{ width: '100%', maxWidth: 440, margin: 0 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', color: 'var(--green)', marginBottom: 8 }}>
              Hide {hideTarget.kind === 'kitchen' ? 'this kitchen' : 'this meal'}?
            </h2>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
              It comes off the board right away. The owner will see this reason word for word,
              and only an admin can undo it.
            </p>
            <div className="form-group">
              <label className="form-label">Reason (required)</label>
              <textarea
                className="form-textarea"
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                placeholder={hideTarget.kind === 'kitchen' ? 'Why is this kitchen being hidden?' : 'Why is this meal being hidden?'}
              />
            </div>
            {modalError && <Alert type="error" style={{ marginBottom: 12 }}>{modalError}</Alert>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setHideTarget(null)} disabled={working}>Never mind</button>
              <button className="btn btn-danger" onClick={confirmHide} disabled={working || !reason.trim()}>
                {working ? <Spinner size="sm" /> : 'Hide it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
