import { useEffect, useState, type CSSProperties } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * The embed panel URL. Defaults to the same-origin /embed/drawer route.
   * A cross-origin consumer (e.g. Exchange) passes the Passport origin so the
   * same "My Passport" panel renders everywhere.
   */
  embedUrl?: string;
}

// Opens the shared "My Passport" panel (the same /embed/drawer surface the
// passport-sdk launcher loads) in a slide-in iframe drawer. The iframe is only
// pointed at the panel while open, and reset to about:blank when closed, so a
// closed drawer holds no background CPU/memory.
export default function ScanDrawer({ open, onClose, embedUrl = '/embed/drawer' }: Props) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // The panel asks its host to close via postMessage. Only trust messages from
  // the panel's own origin.
  useEffect(() => {
    const panelOrigin = embedUrl.startsWith('http')
      ? new URL(embedUrl).origin
      : window.location.origin;
    function onMessage(e: MessageEvent) {
      if (e.origin !== panelOrigin) return;
      if (e.data && e.data.type === 'CLOSE_PASSPORT_DRAWER') onClose();
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onClose, embedUrl]);

  const wrapperStyle: CSSProperties = isDesktop
    ? {
        top: 0,
        bottom: 0,
        right: 0,
        left: 'auto',
        width: 420,
        maxWidth: '100%',
        height: '100vh',
        transform: open ? 'translate(0, 0)' : 'translate(100%, 0)',
        borderTopLeftRadius: 16,
        borderBottomLeftRadius: 16,
      }
    : {
        bottom: 0,
        left: '50%',
        width: '100%',
        maxWidth: 480,
        height: '100vh',
        transform: open ? 'translate(-50%, 0)' : 'translate(-50%, 100%)',
      };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99998,
        pointerEvents: open ? 'auto' : 'none',
        background: open ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0)',
        backdropFilter: open ? 'blur(2px)' : 'none',
        transition: 'background 0.3s ease',
      }}
    >
      <div
        style={{
          position: 'absolute',
          background: 'var(--cream)',
          overflow: 'hidden',
          boxShadow: '0 -4px 24px rgba(0, 0, 0, 0.25)',
          transition: 'transform 0.3s cubic-bezier(0.32, 0.94, 0.6, 1)',
          ...wrapperStyle,
        }}
      >
        <iframe
          title="My Passport Drawer"
          src={open ? embedUrl : 'about:blank'}
          allow="geolocation"
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>
    </div>
  );
}
