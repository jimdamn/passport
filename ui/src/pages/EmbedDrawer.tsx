import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { Spinner } from '../components/ui/Spinner';
import { X, Award, Compass, QrCode, Camera, MapPin } from 'lucide-react';
import QrDrawer from '../components/ui/QrDrawer';

declare global {
  interface Window {
    BarcodeDetector: any;
  }
}

export default function EmbedDrawer() {
  const { user, token } = useAuth();
  const { tenant } = useTenant();
  const [realScans, setRealScans] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [qrOpen, setQrOpen] = useState<boolean>(false);
  const [creditsBalance, setCreditsBalance] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanError, setScanError] = useState<string>('');
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [externalUrl, setExternalUrl] = useState<string>('');

  const creditsName = tenant?.config.credits_name ?? 'KrowdKredits';

  useEffect(() => {
    // Detect mobile viewport
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);

    if (user && token && tenant) {
      fetchStampsData();
      fetchCreditsBalance();
    } else {
      setLoading(false);
    }

    return () => window.removeEventListener('resize', checkMobile);
  }, [user, token, tenant]);

  const fetchStampsData = async () => {
    try {
      const res = await fetch(`/api/t/${tenant?.id}/passport/stamps`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json() as { data: { scans: any[] } };
        setRealScans(json.data.scans || []);
      }
    } catch (err) {
      console.error('Failed to load stamps history:', err);
    }
  };

  const fetchCreditsBalance = async () => {
    try {
      const res = await fetch(`/api/t/${tenant?.id}/credits/balance`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json() as { data: { balance: number } };
        setCreditsBalance(json.data.balance || 0);
      }
    } catch (err) {
      console.error('Failed to fetch credits balance:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    window.parent.postMessage({ type: 'CLOSE_PASSPORT_DRAWER' }, '*');
  };

  // Resize high-resolution mobile photos to prevent Out-Of-Memory crashes
  const resizeImage = (file: File, maxSize = 600): Promise<HTMLCanvasElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas context not available'));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      img.src = url;
    });
  };

  // Decode QR Code from camera photo
  const handleCameraScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanError('');
    setLoading(true);

    try {
      // Check if BarcodeDetector is supported natively in browser
      if ('BarcodeDetector' in window) {
        const barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
        
        // Downscale image to ~600px max bounds (reduces RAM from ~150MB to ~1.4MB!)
        const canvas = await resizeImage(file, 600);
        
        const barcodes = await barcodeDetector.detect(canvas);
        if (barcodes && barcodes.length > 0) {
          const qrValue = barcodes[0].rawValue || '';
          
          // Verify if it is a valid HTTP/HTTPS URL
          const isUrl = qrValue.startsWith('http://') || qrValue.startsWith('https://');
          if (!isUrl) {
            setScanError('Scanned code is not a valid regional destination link.');
            setLoading(false);
            return;
          }

          // Check if it belongs to our regional network
          const isNetwork = qrValue.includes('lakeandlocals.com') || 
                            qrValue.includes('krowdkraft.com') || 
                            qrValue.includes('localhost') || 
                            qrValue.includes('127.0.0.1');

          if (isNetwork) {
            window.top!.location.href = qrValue;
          } else {
            setExternalUrl(qrValue);
            setLoading(false);
          }
        } else {
          setScanError('No QR Code was detected. Please stand closer with clear lighting and focus.');
          setLoading(false);
        }
      } else {
        // Fallback for older browsers: redirect to standard scan portal instructions
        setScanError('Native camera scanning is not fully supported on this browser version. Please scan using your phone\'s native camera app.');
        setLoading(false);
      }
    } catch (err: any) {
      setScanError(err.message || 'Failed to read the image. Please try again.');
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'rgba(0,0,0,0.05)'
      }}>
        <Spinner size="md" />
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{
        padding: '32px 20px',
        textAlign: 'center',
        height: '100vh',
        background: 'var(--cream)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <Award size={48} color="var(--green)" style={{ marginBottom: 16 }} />
        <h2 style={{ fontFamily: 'var(--font-serif)', color: 'var(--green)', marginBottom: 10 }}>My Passport</h2>
        <p style={{ fontFamily: 'var(--font-sans)', color: 'var(--muted)', fontSize: '0.9rem', marginBottom: 20, maxWidth: 300 }}>
          Please sign in to view your Passport stamps and credits.
        </p>
        <a
          className="btn btn-primary btn-block"
          href={`${window.location.origin}/auth/login?return_to=${encodeURIComponent(document.referrer || 'https://apps.lakeandlocals.com')}`}
          target="_top"
          style={{ maxWidth: 240 }}
        >
          Sign In
        </a>
      </div>
    );
  }

  if (externalUrl) {
    return (
      <div style={{
        padding: '32px 24px',
        textAlign: 'center',
        height: '100vh',
        background: 'var(--cream)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative'
      }}>
        {/* Close button top right */}
        <button
          onClick={() => {
            setExternalUrl('');
            setScanError('');
          }}
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--green)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: '50%'
          }}
        >
          <X size={24} />
        </button>

        <div style={{
          background: 'var(--white)',
          padding: '28px 24px',
          borderRadius: 'var(--r-lg)',
          border: '1px solid var(--border)',
          boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
          width: '100%',
          maxWidth: 320,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'rgba(217, 119, 6, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16
          }}>
            <Compass size={28} color="var(--amber)" />
          </div>

          <h3 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '1.25rem',
            color: 'var(--green)',
            marginBottom: 8,
            fontWeight: 'bold'
          }}>
            External Destination
          </h3>

          <p style={{
            fontFamily: 'var(--font-sans)',
            color: 'var(--muted)',
            fontSize: '0.85rem',
            lineHeight: '1.4',
            marginBottom: 20
          }}>
            You scanned a regional partner link outside of our core network. Would you like to proceed?
          </p>

          {/* Scanned URL display */}
          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 'var(--r-sm)',
            padding: '10px 12px',
            width: '100%',
            fontSize: '0.75rem',
            color: 'var(--muted)',
            fontFamily: 'monospace',
            wordBreak: 'break-all',
            textAlign: 'left',
            marginBottom: 24
          }}>
            {externalUrl}
          </div>

          {/* Action buttons */}
          <button
            className="btn btn-green btn-block"
            onClick={() => {
              window.top!.location.href = externalUrl;
            }}
            style={{
              marginBottom: 10,
              minHeight: 44,
              fontWeight: 600
            }}
          >
            Visit Destination
          </button>

          <button
            className="btn btn-block"
            onClick={() => {
              setExternalUrl('');
              setScanError('');
            }}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              color: 'var(--green)',
              minHeight: 44,
              fontWeight: 600
            }}
          >
            Cancel & Scan Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      height: '100vh',
      background: 'var(--cream)',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--white)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Compass size={18} color="var(--amber)" />
          <h2 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '1.2rem',
            fontWeight: 'bold',
            color: 'var(--green)',
            margin: 0
          }}>
            My Passport
          </h2>
        </div>
        <button
          onClick={handleClose}
          aria-label="Close Passport"
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
            borderRadius: 'var(--r-sm)'
          }}
        >
          <X size={24} />
        </button>
      </div>

      {/* Main Content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px'
      }}>
        {/* User Card with balance */}
        <div className="card" style={{
          background: 'var(--white)',
          padding: '16px',
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.05rem', fontFamily: 'var(--font-serif)' }}>{user.display_name}</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Member Wallet</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--green)' }}>
              {creditsBalance}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600 }}>
              {creditsName}
            </div>
          </div>
        </div>

        {/* Scan Error Message */}
        {scanError && (
          <div className="alert alert-error" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 12 }}>
            {scanError}
          </div>
        )}

        {/* SDK Links Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr',
          gap: 12,
          marginBottom: 20
        }}>
          {/* Link 1: My Code */}
          <button
            onClick={() => setQrOpen(true)}
            className="btn btn-amber"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              minHeight: 44
            }}
          >
            <QrCode size={18} /> My Code
          </button>

          {/* Link 2: Scan Now (Mobile only) */}
          {isMobile && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-green"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                minHeight: 44
              }}
            >
              <Camera size={18} /> Scan Now
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleCameraScan}
                style={{ display: 'none' }}
              />
            </button>
          )}
        </div>

        {/* Collected Stamps list */}
        <h4 style={{
          fontFamily: 'var(--font-serif)',
          color: 'var(--green)',
          fontSize: '0.95rem',
          fontWeight: 'bold',
          marginBottom: 10
        }}>
          Stamps Collected
        </h4>

        {realScans.length === 0 ? (
          <div style={{
            background: 'var(--white)',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--r-md)',
            padding: '24px 16px',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: '0.85rem'
          }}>
            <Award size={32} style={{ margin: '0 auto 8px auto', opacity: 0.5 }} />
            No stamps collected yet. Head out and scan QR codes in your region!
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gap: 12
          }}>
            {realScans.map((scan: any) => (
              <div
                key={scan.id}
                style={{
                  background: 'var(--white)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  padding: '12px',
                  textAlign: 'center',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
                }}
              >
                <div style={{ marginBottom: 6, color: 'var(--amber)', display: 'flex', justifyContent: 'center' }}><MapPin size={26} strokeWidth={2} aria-hidden="true" /></div>
                <div style={{
                  fontWeight: 'bold',
                  fontSize: '0.8rem',
                  color: 'var(--green)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {scan.name}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                  {scan.location_name}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <QrDrawer
        open={qrOpen}
        onClose={() => setQrOpen(false)}
      />
    </div>
  );
}
