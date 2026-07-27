import { useState, useEffect } from 'react';
import { VenetianMask } from 'lucide-react';
import { Drawer } from 'kk-shared-ui';
import { getAnonymousPersona, updateAnonymousPersona, updatePersona } from '../../api/profile';
import { Alert } from '../ui/Alert';

interface Props {
  open: boolean;
  currentPersona: 'anonymous' | 'personal' | 'business';
  tenantId: string;
  onClose: () => void;
  onSwitch: () => void;
}

export function AnonymousPersonaDrawer({
  open,
  currentPersona,
  tenantId,
  onClose,
  onSwitch,
}: Props) {
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setErrorMsg(null);
      setSuccessMsg(null);
      setLoading(true);
      getAnonymousPersona(tenantId)
        .then((res) => {
          setDisplayName(res.data?.display_name || '');
        })
        .catch((err) => {
          setErrorMsg(err?.message || 'Failed to load anonymous settings.');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, tenantId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await updateAnonymousPersona(tenantId, displayName.trim());
      setSuccessMsg('Anonymous settings saved successfully.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save settings.');
    } finally {
      setLoading(false);
    }
  };

  const handleSwitch = async () => {
    setSwitching(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await updatePersona('anonymous');
      onSwitch();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to switch persona.');
    } finally {
      setSwitching(false);
    }
  };

  const isPending = loading || switching;

  return (
    <Drawer open={open} onClose={onClose} side="right" ariaLabel="Anonymous Persona Settings">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--green)',
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--r-sm)',
              flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <h2 data-drawer-heading style={{ fontFamily: 'var(--font-serif)', fontSize: '1.15rem', fontWeight: 'bold', color: 'var(--green)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <VenetianMask size={20} strokeWidth={2} aria-hidden="true" /> Anonymous Persona
          </h2>
        </div>

        <div style={{
          background: 'var(--white)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          padding: '14px 16px',
          marginBottom: 20,
        }}>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.84rem', color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
            When you post as Anonymous, other members see your anonymous display name instead of your real name. Your identity remains completely private.
          </p>
        </div>

        {errorMsg && <Alert type="error" style={{ marginBottom: 16 }}>{errorMsg}</Alert>}
        {successMsg && <Alert type="success" style={{ marginBottom: 16 }}>{successMsg}</Alert>}

        {currentPersona !== 'anonymous' && (
          <button
            type="button"
            className="btn btn-amber btn-block"
            style={{ marginBottom: 20 }}
            disabled={isPending}
            onClick={handleSwitch}
          >
            {switching ? 'Switching...' : 'Set as Active Persona'}
          </button>
        )}

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label className="form-label" htmlFor="anonDisplayName">Anonymous Display Name</label>
            <input
              className="form-input"
              type="text"
              id="anonDisplayName"
              maxLength={60}
              placeholder="e.g. Lakeside Regular"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
            <p className="form-hint">Shown instead of 'A L&L Member' when posting anonymously.</p>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={isPending}
          >
            {loading ? 'Saving...' : 'Save Settings'}
          </button>
        </form>
    </Drawer>
  );
}
