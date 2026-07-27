import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Compass, AlertCircle, Printer, Download, MapPin } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { getToken } from '../../api/client';

interface Props {
  open: boolean;
  onClose: () => void;
}

type QrStatus = 'loading' | 'ok' | 'no-location' | 'error';

export default function MerchantQrDrawer({ open, onClose }: Props) {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<QrStatus>('loading');

  const creditsName = tenant?.config.credits_name ?? 'KrowdKredits';

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Fetch the QR SVG with the Authorization header (never put the token in a
  // URL - query strings end up in logs and browser history). The blob object
  // URL also serves the print flyer and the download link.
  //
  // A 404 here specifically means "verified business with no check-in location
  // on file yet" (see auth.ts's /merchant/qr-code handler) - surface that as an
  // actionable message instead of silently leaving the QR box empty.
  useEffect(() => {
    if (!open) return;
    let objectUrl: string | null = null;
    setQrStatus('loading');
    const token = getToken();
    fetch('/api/auth/merchant/qr-code', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then(res => {
        if (res.ok) return res.blob();
        setQrStatus(res.status === 404 ? 'no-location' : 'error');
        return null;
      })
      .then(blob => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setQrCodeUrl(objectUrl);
          setQrStatus('ok');
        }
      })
      .catch(() => setQrStatus('error'));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setQrCodeUrl(null);
      setQrStatus('loading');
    };
  }, [open]);

  if (!user || !user.business_id) return null;

  const handlePrint = () => {
    if (!qrCodeUrl) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Print QR Code - ${user.business_name || 'Merchant'}</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: #fff;
              color: #1e3320;
              text-align: center;
            }
            .container {
              border: 3px solid #1e3320;
              padding: 40px;
              border-radius: 24px;
              max-width: 450px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.05);
            }
            h1 {
              font-size: 2.2rem;
              margin: 0 0 8px 0;
              font-weight: 800;
            }
            p {
              font-size: 1.1rem;
              color: #536b56;
              margin: 0 0 30px 0;
            }
            .qr-box {
              background: #fff;
              border: 1px solid #ddd;
              padding: 20px;
              border-radius: 16px;
              display: inline-block;
              margin-bottom: 24px;
            }
            img {
              width: 280px;
              height: 280px;
            }
            .footer {
              font-size: 0.9rem;
              font-weight: bold;
              opacity: 0.8;
            }
            @media print {
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Scan &amp; Check In</h1>
            <p>Support <strong>${user.business_name}</strong> and collect stamps!</p>
            <div class="qr-box">
              <img src="${qrCodeUrl}" alt="Check-in QR Code" />
            </div>
            <div class="footer">Powered by ${tenant?.config.brand_name || 'Lake & Locals'} Passport</div>
            <br />
            <button class="no-print" onclick="window.print()" style="padding: 10px 20px; font-weight: bold; background: #1e3320; color: white; border: none; border-radius: 8px; cursor: pointer;">Print Now</button>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

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
        aria-label="Merchant Check-in QR Code"
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
        {/* Grabber Drag Handle */}
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
            <Compass size={18} color="var(--green)" />
            <h2 style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '1.15rem',
              fontWeight: 'bold',
              color: 'var(--green)',
              margin: 0,
            }}>
              Merchant Check-in QR Code
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
            {open && qrStatus === 'ok' && qrCodeUrl && (
              <img
                src={qrCodeUrl}
                alt="Business Check-in QR Code"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
              />
            )}
            {open && qrStatus === 'no-location' && (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <MapPin size={28} color="var(--amber)" />
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                  Add your business location to activate your check-in QR code.
                </p>
              </div>
            )}
            {open && qrStatus === 'error' && (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={28} color="var(--error)" />
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                  Couldn't load your QR code. Please try again.
                </p>
              </div>
            )}
          </div>

          {qrStatus === 'no-location' && (
            <Link
              to="/merchant"
              onClick={onClose}
              className="btn btn-amber btn-sm"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                textDecoration: 'none', marginBottom: 20, fontSize: '0.85rem', fontWeight: 600, minHeight: 38,
              }}
            >
              <MapPin size={15} /> Set Business Location
            </Link>
          )}

          {/* Business Name */}
          <h3 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '1.2rem',
            fontWeight: 'bold',
            color: 'var(--green)',
            margin: '0 0 6px 0',
          }}>
            {user.business_name}
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
            MERCHANT ID: KK-BIZ-{user.business_id}
          </div>

          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '0.85rem',
            color: 'var(--muted)',
            lineHeight: 1.5,
            maxWidth: 340,
            margin: '0 0 20px 0',
          }}>
            Display this QR code physically at your register, host stand, or checkout. Customers scan it with their mobile cameras to verify their visit, unlock their regional stamp, and earn {creditsName}!
          </p>

          {/* Print/Download CTA button row */}
          {qrStatus === 'ok' && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, width: '100%', maxWidth: 340 }}>
            <button
              onClick={handlePrint}
              className="btn btn-green"
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontSize: '0.85rem',
                fontWeight: 600,
                minHeight: 40,
              }}
            >
              <Printer size={16} /> Print Flyer
            </button>
            <a
              href={qrCodeUrl ?? '#'}
              download={`qr-code-${user.business_name || 'business'}.svg`}
              className="btn btn-secondary"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontSize: '0.85rem',
                fontWeight: 600,
                minHeight: 40,
                textDecoration: 'none'
              }}
            >
              <Download size={16} /> Download SVG
            </a>
          </div>
          )}

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
              Check-ins only count when the scan happens at your place.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
