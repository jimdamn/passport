import { useEffect } from 'react';
import { X, ScrollText } from 'lucide-react';
import type { KwestRules } from '../../api/kwest';

interface Props {
  open: boolean;
  onClose: () => void;
  rules: KwestRules | null;
}

// Long-form Official Rules, dismissible - bottom-sheet mirrors QrDrawer.tsx.
export default function RulesModal({ open, onClose, rules }: Props) {
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
          zIndex: 400, display: open ? 'block' : 'none', transition: 'opacity 0.25s ease',
        }}
      />
      <aside
        aria-label="Official Rules"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, maxHeight: '85vh',
          background: 'var(--cream)', borderTopLeftRadius: 'var(--r-lg)', borderTopRightRadius: 'var(--r-lg)',
          borderTop: '1px solid var(--border)', boxShadow: '0 -4px 24px rgba(0,0,0,0.15)', zIndex: 401,
          display: 'flex', flexDirection: 'column',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.28s cubic-bezier(0.32,0.94,0.6,1)',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: 44, height: 5, background: '#ddd8cc', borderRadius: 3, margin: '10px auto 4px auto', flexShrink: 0 }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ScrollText size={18} color="var(--amber)" />
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--green)', margin: 0 }}>
              Official Rules
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--r-sm)' }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '20px' }}>
          {rules ? (
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {rules.official_rules}
            </p>
          ) : (
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Loading...</p>
          )}
        </div>
      </aside>
    </>
  );
}
