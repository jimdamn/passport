import { useState, useEffect } from 'react';
import { Compass } from 'lucide-react';
import { getAroundInterests, putAroundInterests, toggleInterest, LAST_LENS_KEY, type AroundInterests } from '../../api/around';
import InterestChips from '../explore/InterestChips';
import { Alert } from '../ui/Alert';

// The profile-side twin of the Around Town board's first-visit picker -
// same chips, same PUT, opened from the "Where Around Town opens" card.
// Follows the PersonalPersonaDrawer pattern (right-side sheet, load-on-open,
// quiet inline confirmation, no credits/fanfare on save).
//
// Re-aim on save: this drawer lives outside the board page, so it does not
// call the board's useLens().setLens directly (no cross-component state
// machinery) - it writes LAST_LENS_KEY itself; the board picks the new lens
// up on its next mount. This never touches chip order, only where the board
// opens.

interface Props {
  open: boolean;
  tenantId: string;
  onClose: () => void;
  onSaved: (data: AroundInterests) => void;
}

export function AroundInterestsDrawer({ open, tenantId, onClose, onSaved }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    setSavedMsg(false);
    setLoading(true);
    getAroundInterests(tenantId)
      // Existing-data note: rows saved before single-pick shipped may hold a
      // multi-element array - treat the first element as the pick everywhere,
      // never render more than one chip active. The next save naturally
      // normalizes the stored row to a single-element (or empty) array.
      .then(res => setSelected(res.data.interests.slice(0, 1)))
      .catch(err => setErrorMsg(err?.message || 'Failed to load your interests.'))
      .finally(() => setLoading(false));
  }, [open, tenantId]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  async function handleSave() {
    setSaving(true);
    setErrorMsg(null);
    setSavedMsg(false);
    try {
      const res = await putAroundInterests(tenantId, selected);
      onSaved(res.data);
      // Re-aim: the board opens on this pick next time ('everything' when
      // selected is the empty skip). Device-local only, no cross-component
      // state machinery - the board reads this on its next mount.
      localStorage.setItem(LAST_LENS_KEY, selected[0] ?? 'everything');
      setSavedMsg(true);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not save your picks. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const isPending = loading || saving;

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: open ? 'block' : 'none' }}
      />

      <aside
        aria-label="Where Around Town opens"
        aria-hidden={!open}
        {...(!open ? { inert: '' } : {})}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(400px, 100vw)',
          background: 'var(--cream)', zIndex: 201, display: 'flex', flexDirection: 'column',
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          paddingRight: 'max(16px, env(safe-area-inset-right))',
          paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
          paddingLeft: '16px', overflowY: 'auto',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)',
              width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 'var(--r-sm)', flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.15rem', fontWeight: 'bold', color: 'var(--green)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Compass size={20} strokeWidth={2} aria-hidden="true" /> Where Around Town opens
          </h2>
        </div>

        <div style={{
          background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
          padding: '14px 16px', marginBottom: 20,
        }}>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.84rem', color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
            What do you check most? We'll open the board there.
          </p>
        </div>

        {errorMsg && <Alert type="error" style={{ marginBottom: 16 }}>{errorMsg}</Alert>}
        {savedMsg && <Alert type="success" style={{ marginBottom: 16 }}>Saved.</Alert>}

        <div style={{ marginBottom: 20 }}>
          <InterestChips value={selected} onToggle={slug => setSelected(prev => toggleInterest(prev, slug))} />
        </div>

        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={isPending}
          onClick={handleSave}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>

        <p style={{ margin: '12px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
          Change anytime from your profile.
        </p>
      </aside>
    </>
  );
}
