import { useEffect, useState } from 'react';
import { X, Compass, AlertCircle } from 'lucide-react';
import { Drawer } from 'kk-shared-ui';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { getToken } from '../../api/client';
import { Spinner } from './Spinner';

interface Props {
  open: boolean;
  onClose: () => void;
}

type QrStatus = 'loading' | 'ok' | 'error';

export default function QrDrawer({ open, onClose }: Props) {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<QrStatus>('loading');
  const [retryTick, setRetryTick] = useState(0);

  const creditsName = tenant?.config.credits_name ?? 'KrowdKredits';

  // Fetch the QR SVG with the Authorization header (never put the token in a
  // URL - query strings end up in logs and browser history) and render it
  // via a blob object URL.
  useEffect(() => {
    if (!open) return;
    let objectUrl: string | null = null;
    setQrStatus('loading');
    const token = getToken();
    fetch('/api/auth/me/qr-code', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then(res => {
        if (res.ok) return res.blob();
        setQrStatus('error');
        return null;
      })
      .then(blob => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setQrSrc(objectUrl);
          setQrStatus('ok');
        }
      })
      .catch(() => setQrStatus('error'));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setQrSrc(null);
      setQrStatus('loading');
    };
  }, [open, retryTick]);

  if (!user) return null;

  return (
    <Drawer open={open} onClose={onClose} side="bottom" ariaLabel="My Personal QR Code">
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Compass size={18} color="var(--amber)" />
            <h2 data-drawer-heading style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '1.15rem',
              fontWeight: 'bold',
              color: 'var(--green)',
              margin: 0,
            }}>
              My Code
            </h2>
          </div>
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
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.04)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div style={{
          overflowY: 'auto',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}>
          {/* QR Code Container */}
          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            padding: 16,
            width: 240,
            height: 240,
            boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
            overflow: 'hidden',
          }}>
            {open && qrStatus === 'ok' && qrSrc && (
              <img
                src={qrSrc}
                alt="My Personal QR Code"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
              />
            )}
            {open && qrStatus === 'loading' && (
              <Spinner size="md" />
            )}
            {open && qrStatus === 'error' && (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={28} color="var(--error)" />
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                  Couldn't load your code. Check your connection and try again.
                </p>
                <button
                  type="button"
                  onClick={() => setRetryTick(t => t + 1)}
                  className="btn btn-secondary btn-sm"
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* Member Name */}
          <h3 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '1.1rem',
            fontWeight: 'bold',
            color: 'var(--green)',
            margin: '0 0 6px 0',
          }}>
            {user.display_name}
          </h3>

          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '0.85rem',
            color: 'var(--muted)',
            lineHeight: 1.5,
            maxWidth: 320,
            margin: '0 0 20px 0',
          }}>
            Show this QR code to other members or local businesses. They can scan it to send you {creditsName}.
          </p>

          {/* Secure Badge Info */}
          <div style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            background: 'rgba(30,51,32,0.04)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: '10px 14px',
            width: '100%',
            maxWidth: 340,
          }}>
            <AlertCircle size={16} color="var(--sage)" style={{ flexShrink: 0 }} />
            <p style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '0.72rem',
              color: 'var(--green)',
              margin: 0,
              textAlign: 'left',
              lineHeight: 1.45,
            }}>
              This code is yours alone. It only works while you are signed in.
            </p>
          </div>
        </div>
    </Drawer>
  );
}
