import { useState } from 'react';
import { X, User, UserRoundCheck } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultChoice: 'anonymous' | 'real';
  realName: string | null;
  anonymousName: string;
  onChoose: (choice: 'anonymous' | 'real') => Promise<void>;
}

// "How should we list you?" - bottom-sheet mirrors QrDrawer.tsx. Editable
// any time before a hunt's official end (the server rejects the request
// once display_locked=1, and this drawer surfaces that calmly).
export default function DisplayChoiceDrawer({ open, onClose, defaultChoice, realName, anonymousName, onChoose }: Props) {
  const [choice, setChoice] = useState<'anonymous' | 'real'>(defaultChoice);
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onChoose(choice);
      onClose();
    } catch {
      setLocked(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
          zIndex: 400, display: open ? 'block' : 'none',
        }}
      />
      <aside
        aria-label="How should we list you"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, maxHeight: '70vh',
          background: 'var(--cream)', borderTopLeftRadius: 'var(--r-lg)', borderTopRightRadius: 'var(--r-lg)',
          borderTop: '1px solid var(--border)', boxShadow: '0 -4px 24px rgba(0,0,0,0.15)', zIndex: 401,
          display: 'flex', flexDirection: 'column',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.28s cubic-bezier(0.32,0.94,0.6,1)',
        }}
      >
        <div style={{ width: 44, height: 5, background: '#ddd8cc', borderRadius: 3, margin: '10px auto 4px auto', flexShrink: 0 }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--green)', margin: 0 }}>
            How should we list you?
          </h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '20px', overflowY: 'auto' }}>
          <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--muted)' }}>
            This is how your name appears on the winners page. You can change your mind any time until the hunt officially closes.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            <button
              onClick={() => setChoice('anonymous')}
              className="card"
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', textAlign: 'left', width: '100%',
                background: 'var(--white)', border: choice === 'anonymous' ? '2px solid var(--amber)' : '1px solid var(--border)',
              }}
            >
              <User size={20} style={{ color: 'var(--amber)', flexShrink: 0 }} />
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>{anonymousName}</p>
                <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--muted)' }}>Anonymous handle</p>
              </div>
            </button>
            {realName && (
              <button
                onClick={() => setChoice('real')}
                className="card"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', textAlign: 'left', width: '100%',
                  background: 'var(--white)', border: choice === 'real' ? '2px solid var(--amber)' : '1px solid var(--border)',
                }}
              >
                <UserRoundCheck size={20} style={{ color: 'var(--amber)', flexShrink: 0 }} />
                <div>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>{realName}</p>
                  <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--muted)' }}>Your personal name</p>
                </div>
              </button>
            )}
          </div>

          {locked && (
            <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--amber)' }}>
              This hunt has officially closed, so the winners list is now final.
            </p>
          )}

          <button className="btn btn-amber btn-block" style={{ minHeight: 44 }} disabled={saving || locked} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </aside>
    </>
  );
}
