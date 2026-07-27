import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Store } from 'lucide-react';
import { updatePersona } from '../../api/profile';
import { Alert } from '../ui/Alert';

interface Props {
  open: boolean;
  currentPersona: 'anonymous' | 'personal' | 'business';
  businessStatus: 'pending' | 'verified' | 'rejected' | null | undefined;
  businessName: string | null | undefined;
  onClose: () => void;
  onSwitch: () => void;
}

export function BusinessPersonaDrawer({
  open,
  currentPersona,
  businessStatus,
  businessName,
  onClose,
  onSwitch,
}: Props) {
  const [switching, setSwitching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setErrorMsg(null);
    }
  }, [open]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleSwitch = async () => {
    setSwitching(true);
    setErrorMsg(null);
    try {
      await updatePersona('business');
      onSwitch();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to switch persona.');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 200,
          display: open ? 'block' : 'none',
        }}
      />

      <aside
        aria-label="Business Persona Settings"
        aria-hidden={!open}
        data-kk-drawer-open={open || undefined}
        {...(!open ? { inert: '' } : {})}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(400px, 100vw)',
          background: 'var(--cream)',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          paddingRight: 'max(16px, env(safe-area-inset-right))',
          paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
          paddingLeft: '16px',
          overflowY: 'auto',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease',
        }}
      >
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
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.15rem', fontWeight: 'bold', color: 'var(--green)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Store size={20} strokeWidth={2} aria-hidden="true" /> Business Persona
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
            The Business persona posts and interacts under your business name. Only verified merchant accounts can use this persona.
          </p>
        </div>

        {errorMsg && <Alert type="error" style={{ marginBottom: 16 }}>{errorMsg}</Alert>}

        {businessStatus === 'verified' && (
          <>
            {currentPersona !== 'business' && (
              <button
                type="button"
                className="btn btn-amber btn-block"
                style={{ marginBottom: 20 }}
                disabled={switching}
                onClick={handleSwitch}
              >
                {switching ? 'Switching...' : 'Set as Active Persona'}
              </button>
            )}

            <div className="form-group">
              <label className="form-label">Business Name</label>
              <input
                className="form-input"
                type="text"
                value={businessName || ''}
                readOnly
                style={{ background: '#f5f5f5', color: 'var(--muted)', cursor: 'not-allowed' }}
              />
              <p className="form-hint" style={{ marginTop: 8, lineHeight: 1.4 }}>
                Your business details are managed from your <Link to="/merchant">Merchant Dashboard</Link>.
              </p>
            </div>
          </>
        )}

        {businessStatus === 'pending' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.5, margin: 0 }}>
              Your merchant application is under review. The Business persona will be available once approved.
            </p>
          </div>
        )}

        {businessStatus === 'rejected' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16 }}>
              Your merchant application was not approved. Please re-apply to use the Business persona.
            </p>
            <Link to="/profile/apply-merchant" className="btn btn-amber btn-block" onClick={onClose} style={{ textDecoration: 'none' }}>
              Re-apply Now
            </Link>
          </div>
        )}

        {(businessStatus === null || businessStatus === undefined) && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16 }}>
              You don't have a business profile yet. Apply for a merchant account to use the Business persona.
            </p>
            <Link to="/profile/apply-merchant" className="btn btn-amber btn-block" onClick={onClose} style={{ textDecoration: 'none' }}>
              Apply for Merchant Profile
            </Link>
          </div>
        )}
      </aside>
    </>
  );
}
