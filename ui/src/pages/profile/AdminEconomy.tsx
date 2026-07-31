import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import {
  getEconomy, previewEconomy, applyEconomy,
  type EconomyValueRow, type EconomyGuardRow, type EconomyApplyOutcome,
} from '../../api/economy';
import { ArrowLeft, Gauge, ShieldAlert, TriangleAlert, CircleOff, Save } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';
import { Badge } from '../../components/ui/Badge';

// Economy admin screen (Increment 1). The browser never computes a credit
// value - the modifier input only sends a candidate number to the preview
// endpoint and renders whatever comes back. Preview and apply share one
// server-side function (src/handlers/economy.ts -> economy-scale.ts), which
// is the whole point: two implementations that could drift is the exact
// shape of the 2026-07-30 incident this feature exists to prevent.
//
// Fix round 1: Save is gated on `previewedModifier` (what the server actually
// returned), never on the typed `candidate` - a keystroke can never enable
// Save before its preview has round-tripped. A request-sequence counter
// discards any preview response that is no longer the latest one in flight,
// so a fast second keystroke can't have an earlier response land after it.
// An empty or invalid field reverts the table to the last-known saved
// snapshot rather than leaving a stale preview on screen under a "matches
// saved" message. Drift styling is suppressed while the displayed rows are a
// hypothetical (previewed-but-not-saved) state, because comparing a
// candidate's computed value against a live value that reflects the OLD
// modifier is not real drift - it is just the size of the proposed change.

interface ViewSnapshot {
  rows: EconomyValueRow[];
  guards: EconomyGuardRow[];
}

const EMPTY_SNAPSHOT: ViewSnapshot = { rows: [], guards: [] };

const TARGET_LABELS: Record<string, string> = {
  kkgame: 'the Game Engine',
  exchange: 'the Exchange',
  passport: 'Passport',
};

function targetLabel(key: string): string {
  return TARGET_LABELS[key] ?? key;
}

const GROUP_LABELS: Record<string, string> = {
  actions: 'Actions',
  quests: 'Quests',
  kwest: 'KrowdKwest defaults',
  hunt: 'Treasure hunt tiers',
  onboarding: 'Onboarding bonuses',
};

function groupLabel(key: string): string {
  return GROUP_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function groupRows(rows: EconomyValueRow[]): Array<{ key: string; rows: EconomyValueRow[] }> {
  const byKey = new Map<string, EconomyValueRow[]>();
  for (const row of rows) {
    const key = row.group_key ?? 'other';
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(row);
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }
  const groups = Array.from(byKey.entries()).map(([key, groupedRows]) => ({ key, rows: groupedRows }));
  groups.sort((a, b) => (a.rows[0]?.sort_order ?? 0) - (b.rows[0]?.sort_order ?? 0));
  return groups;
}

/** Parses the modifier text field into the number the server expects, or null if not currently valid. Never used for arithmetic - only to build the request body. */
function parseModifierInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 5) return null;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-9) return null;
  return n;
}

function LiveValue({ row, suppressDrift }: { row: EconomyValueRow; suppressDrift: boolean }) {
  if (row.status === 'unavailable') {
    return <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>unavailable</span>;
  }
  if (row.status === 'orphaned') {
    return <span style={{ color: 'var(--error)', fontStyle: 'italic' }}>orphaned</span>;
  }
  const showDrift = row.drift && !suppressDrift;
  return <span style={showDrift ? { color: 'var(--error)', fontWeight: 600 } : undefined}>{row.live}</span>;
}

function StatusNote({ row, suppressDrift }: { row: EconomyValueRow; suppressDrift: boolean }) {
  if (row.status === 'unavailable') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: 'var(--muted)', marginTop: 2 }}>
        <CircleOff size={11} /> Service unreachable
      </div>
    );
  }
  if (row.status === 'orphaned') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: 'var(--error)', marginTop: 2 }}>
        <TriangleAlert size={11} /> No longer at its target - excluded from apply
      </div>
    );
  }
  if (row.drift && !suppressDrift) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: 'var(--error)', marginTop: 2 }}>
        <TriangleAlert size={11} /> Live value disagrees with computed
      </div>
    );
  }
  return null;
}

function GuardsSection({ guards }: { guards: EconomyGuardRow[] }) {
  if (guards.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 20, borderColor: 'var(--amber)', background: 'var(--white)' }}>
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ShieldAlert size={16} /> Guards
      </div>
      <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: 'var(--muted)' }}>
        Read-only backstops that live outside this dial on purpose. Nothing here can be edited from this screen.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: 560 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Guard</th>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Value</th>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Home</th>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Deploy target</th>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Ratio now</th>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>At baseline</th>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Out of band</th>
            </tr>
          </thead>
          <tbody>
            {guards.map((g) => (
              <tr key={g.key} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 10px' }}>{g.label}</td>
                <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{g.value}</td>
                <td style={{ padding: '8px 10px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{g.home}</td>
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{g.deployTarget}</td>
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{g.ratioNow ?? '-'}</td>
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{g.ratioAtBaseline ?? '-'}</td>
                <td style={{ padding: '8px 10px' }}>
                  {g.outOfBand
                    ? <Badge variant="red">Out of band</Badge>
                    : <Badge variant="green">In band</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminEconomy() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [savedModifier, setSavedModifier] = useState<number | null>(null);
  // Last-known saved snapshot, used only to revert the table when the
  // modifier field is cleared or invalid (finding 4). Kept in a ref rather
  // than state: it does not drive any rendering itself, and as state it was
  // a fresh object on every write, which put a needless extra entry in the
  // preview effect's dependency array and scheduled a redundant preview each
  // time fetchAll or save ran (finding 2, round 2).
  const savedViewRef = useRef<ViewSnapshot>(EMPTY_SNAPSHOT);

  const [draft, setDraft] = useState('');
  const [rows, setRows] = useState<EconomyValueRow[]>([]);
  const [guards, setGuards] = useState<EconomyGuardRow[]>([]);
  // The modifier that `rows`/`guards` currently, actually reflect - set only
  // from a server response, never from the input as it is typed. This is
  // what Save is gated on (finding 1) and what "unsaved" messaging describes,
  // rather than the possibly-still-in-flight `candidate`.
  const [previewedModifier, setPreviewedModifier] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [inputError, setInputError] = useState('');
  const [applyResult, setApplyResult] = useState<{ outcome: EconomyApplyOutcome; failedTargets: string[] } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every new preview attempt (and on save). A response is only
  // applied to state if this counter still matches the value captured when
  // that request started - an older response arriving after a newer one is
  // simply dropped (finding 2).
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!user) { navigate('/auth/login'); return; }
    if (!user.is_admin) { navigate('/profile'); return; }
    if (tenant?.id) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenant?.id]);

  async function fetchAll() {
    if (!tenant) return;
    setLoading(true);
    setError('');
    try {
      const res = await getEconomy(tenant.id);
      requestSeqRef.current++; // invalidate anything already in flight
      setSavedModifier(res.data.modifier);
      setDraft(String(res.data.modifier));
      setRows(res.data.values);
      setGuards(res.data.guards);
      savedViewRef.current = { rows: res.data.values, guards: res.data.guards };
      setPreviewedModifier(res.data.modifier);
    } catch (err: any) {
      setError(err.message || 'Failed to load the economy view.');
    } finally {
      setLoading(false);
    }
  }

  const candidate = useMemo(() => parseModifierInput(draft), [draft]);

  // Debounced preview - fires 250ms after the input settles, only when the
  // draft parses to a valid number. Renders exactly what the server sends;
  // no scaling math happens in this component. When the field is empty or
  // invalid, the table reverts to the last saved snapshot rather than being
  // left showing a stale preview under a message that no longer describes it
  // (finding 4).
  useEffect(() => {
    if (!tenant?.id || savedModifier === null) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (draft.trim() === '') {
      setInputError('');
      requestSeqRef.current++;
      setPreviewing(false);
      setRows(savedViewRef.current.rows);
      setGuards(savedViewRef.current.guards);
      setPreviewedModifier(savedModifier);
      return;
    }
    if (candidate === null) {
      setInputError('Enter a number from 0 to 5, at most two decimal places.');
      requestSeqRef.current++;
      setPreviewing(false);
      setRows(savedViewRef.current.rows);
      setGuards(savedViewRef.current.guards);
      setPreviewedModifier(savedModifier);
      return;
    }
    setInputError('');

    debounceRef.current = setTimeout(async () => {
      const seq = ++requestSeqRef.current;
      setPreviewing(true);
      setError('');
      try {
        const res = await previewEconomy(tenant.id, candidate);
        if (seq !== requestSeqRef.current) return; // a newer request has since started - stale
        setRows(res.data.values);
        setGuards(res.data.guards);
        // From the response, not the locally-captured `candidate` (finding 3,
        // round 2) - identical today since the server validates without
        // normalizing, but this keeps previewedModifier honest if that ever
        // changes.
        setPreviewedModifier(res.data.modifier);
      } catch (err: any) {
        if (seq !== requestSeqRef.current) return;
        setError(err.message || 'Preview failed.');
      } finally {
        if (seq === requestSeqRef.current) setPreviewing(false);
      }
    }, 250);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, tenant?.id, savedModifier]);

  // Whether the currently-typed value has a matching, resolved preview yet.
  const previewPending = candidate !== null && !inputError && previewedModifier !== candidate;
  // Whether what's on screen right now (previewedModifier) differs from what
  // is actually saved - this, not the typed candidate, is what "unsaved"
  // means and what suppresses drift styling (finding 5): comparing a
  // hypothetical candidate's computed value against a live value still
  // reflecting the OLD saved modifier is not real drift.
  const previewDiffersFromSaved = previewedModifier !== null && savedModifier !== null && previewedModifier !== savedModifier;
  const dirty = candidate !== null && savedModifier !== null && candidate !== savedModifier;
  // Save only ever fires against a modifier the server has actually
  // previewed for us - never against whatever happens to be in the text
  // field at the moment of the click (finding 1).
  const readyToSave = dirty && !previewPending && !previewing && previewedModifier === candidate;

  async function save() {
    if (!tenant || candidate === null || saving || !readyToSave) return;
    const seq = ++requestSeqRef.current; // invalidate any preview still in flight
    setSaving(true);
    setError('');
    setApplyResult(null);
    try {
      const res = await applyEconomy(tenant.id, candidate);
      if (seq !== requestSeqRef.current) return; // a newer action started meanwhile
      setSavedModifier(res.data.modifier);
      setDraft(String(res.data.modifier));
      setRows(res.data.values);
      setGuards(res.data.guards);
      savedViewRef.current = { rows: res.data.values, guards: res.data.guards };
      setPreviewedModifier(res.data.modifier);
      const failedTargets = Object.entries(res.data.per_target)
        .filter(([, status]) => status === 'failed')
        .map(([target]) => target);
      setApplyResult({ outcome: res.data.outcome, failedTargets });
    } catch (err: any) {
      setError(err.message || 'Failed to save the modifier.');
    } finally {
      if (seq === requestSeqRef.current) setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const groups = groupRows(rows);

  return (
    <div className="main-content" style={{ maxWidth: 900, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Gauge size={22} /> Economy
        </h1>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        One modifier scales every credit-earning value network-wide. Preview is a real server call -
        it recomputes with the exact function apply uses, so what you see here is what you get.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Modifier</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0, maxWidth: 160 }}>
            <label className="form-label" htmlFor="economy-modifier">Candidate value</label>
            <input
              id="economy-modifier"
              className="form-input"
              type="text"
              inputMode="decimal"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setApplyResult(null); }}
            />
          </div>
          <button className="btn btn-amber btn-sm" disabled={!readyToSave || saving} onClick={save} style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {saving ? <Spinner size="sm" /> : <><Save size={14} /> Save</>}
          </button>
          {previewPending && <span style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Spinner size="sm" /> Previewing {candidate}...</span>}
        </div>

        {inputError && <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--error)' }}>{inputError}</div>}

        {!inputError && draft.trim() === '' && (
          <div style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--muted)' }}>
            Showing the saved value. Type a modifier to preview a change.
          </div>
        )}

        {!inputError && draft.trim() !== '' && !previewPending && previewDiffersFromSaved && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Badge variant="amber">Unsaved</Badge>
            <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
              Saved value is {savedModifier}. The table below shows what {previewedModifier} would produce - nothing is written until you press Save.
            </span>
          </div>
        )}

        {!inputError && draft.trim() !== '' && !previewPending && !previewDiffersFromSaved && (
          <div style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--muted)' }}>
            Matches the saved value ({savedModifier}). Nothing to apply.
          </div>
        )}

        {applyResult && applyResult.outcome === 'applied' && (
          <Alert type="success" style={{ marginTop: 10 }}>Saved. Every target updated.</Alert>
        )}
        {applyResult && applyResult.outcome !== 'applied' && (
          <Alert type="error" style={{ marginTop: 10 }}>
            {/* 'failed' = zero targets succeeded; 'partial' = some did, some
                did not. Each arm must read as true on its own (finding 1,
                round 2) - the old copy said "every target updated" on the
                total-failure path, which contradicted itself. */}
            Modifier saved, but {applyResult.outcome === 'failed' ? 'no target' : 'not every target'} updated:{' '}
            {applyResult.failedTargets.map(targetLabel).join(', ')} failed to receive the new values.
            This is safe to retry - apply always recomputes from baseline, so pressing Save again will not double up.
          </Alert>
        )}

        {previewDiffersFromSaved && (
          <div style={{ marginTop: 10, fontSize: '0.72rem', color: 'var(--muted)' }}>
            Drift indicators below are hidden while previewing an unsaved change - they compare against
            the value each service has right now, which still reflects the saved modifier.
          </div>
        )}
      </div>

      <GuardsSection guards={guards} />

      {groups.map((group) => (
        <div className="card" key={group.key} style={{ marginBottom: 20, background: 'var(--white)', padding: 0 }}>
          <div className="card-title" style={{ padding: '14px 16px 0' }}>{groupLabel(group.key)}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: 640 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Value</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }}>Baseline</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }}>Computed</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }}>Live</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--green)' }}>{row.label ?? row.id}</div>
                      {row.clue && <div style={{ fontSize: '0.76rem', color: 'var(--muted)', marginTop: 2 }}>{row.clue}</div>}
                      {row.rate_note && <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 2 }}>{row.rate_note}</div>}
                      <StatusNote row={row} suppressDrift={previewDiffersFromSaved} />
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{row.baseline}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{row.computed}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      <LiveValue row={row} suppressDrift={previewDiffersFromSaved} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {groups.length === 0 && (
        <div className="card" style={{ padding: 20, textAlign: 'center', background: 'var(--white)' }}>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>No registry rows yet.</p>
        </div>
      )}
    </div>
  );
}
