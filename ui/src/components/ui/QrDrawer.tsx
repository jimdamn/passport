import { useEffect } from 'react';
import { X, Compass, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { getToken } from '../../api/client';

function obfuscateUserId(id: number | string): string {
  const numId = typeof id === 'string' ? parseInt(id, 10) : id;
  if (isNaN(numId)) return String(id);
  // Shift and XOR logic for premium membership key formatting (KK-XXX-XXX)
  const shifted = (numId + 987654) ^ 0xADB8F;
  const b36 = shifted.toString(36).toUpperCase().padStart(6, '0');
  return `KK-${b36.slice(0, 3)}-${b36.slice(3)}`;
}


interface Props {
  open: boolean;
  onClose: () => void;
}

export default function QrDrawer({ open, onClose }: Props) {
  const { user } = useAuth();
  const { tenant } = useTenant();

  const creditsName = tenant?.config.credits_name ?? 'KrowdKredits';

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!user) return null;

  // The dynamic QR Code SVG is fetched directly from our secure authenticated API endpoint.
  // This endpoint verifies user session credentials automatically, providing absolute protection.
  const token = getToken();
  const qrCodeUrl = `/api/auth/me/qr-code?token=${token}`;

  return (
    <>
      {/* Overlay Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(2px)',
          zIndex: 300,
          display: open ? 'block' : 'none',
          transition: 'opacity 0.25s ease',
        }}
      />

      {/* Slide-Up Bottom Drawer */}
      <aside
        aria-label="My Personal QR Code"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: '85vh',
          background: 'var(--cream)',
          borderTopLeftRadius: 'var(--r-lg)',
          borderTopRightRadius: 'var(--r-lg)',
          borderTop: '1px solid var(--border)',
          boxShadow: '0 -4px 24px rgba(0, 0, 0, 0.15)',
          zIndex: 301,
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.28s cubic-bezier(0.32, 0.94, 0.6, 1)',
          overflow: 'hidden',
        }}
      >
        {/* Grabber Drag Handle (Native feel) */}
        <div style={{
          width: 44,
          height: 5,
          background: '#ddd8cc',
          borderRadius: 3,
          margin: '10px auto 4px auto',
          flexShrink: 0,
        }} />

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
            <h2 style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '1.15rem',
              fontWeight: 'bold',
              color: 'var(--green)',
              margin: 0,
            }}>
              My Passport
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
              width: 36,
              height: 36,
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
            {open && (
              <img
                src={qrCodeUrl}
                alt="My Personal QR Code"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
              />
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

          <div style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '0.75rem',
            fontWeight: 700,
            color: 'var(--sage)',
            background: 'rgba(80,120,80,0.1)',
            padding: '3px 10px',
            borderRadius: 'var(--r-pill)',
            marginBottom: 16,
          }}>
            ID: {obfuscateUserId(user.id)}
          </div>

          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '0.85rem',
            color: 'var(--muted)',
            lineHeight: 1.5,
            maxWidth: 320,
            margin: '0 0 20px 0',
          }}>
            Show this QR code to other members or local businesses. They can scan it to instantly transfer {creditsName} to your account.
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
              <strong>Secure Link:</strong> This code is dynamically rendered from your private account session. Unauthenticated users cannot view or scrape this image.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
