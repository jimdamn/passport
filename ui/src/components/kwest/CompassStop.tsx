import { useRef, useState } from 'react';
import { Compass } from 'lucide-react';

interface Props {
  onSubmit: (input: { t_ms: number }) => void;
  disabled: boolean;
}

// One-thumb timing game: the needle spins continuously, tap Stop to record
// how long it spun. The server maps the timing onto its own outcome - this
// component only measures elapsed time and animates the needle.
export default function CompassStop({ onSubmit, disabled }: Props) {
  const [stopped, setStopped] = useState(false);
  const startRef = useRef(Date.now());

  const handleStop = () => {
    if (disabled || stopped) return;
    setStopped(true);
    onSubmit({ t_ms: Date.now() - startRef.current });
  };

  return (
    <div style={{ textAlign: 'center' }}>
      <p style={{ margin: '0 0 20px', fontSize: '0.9rem', color: 'var(--muted)' }}>Tap to stop the needle</p>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
        <div
          style={{
            width: 100, height: 100, borderRadius: '50%', border: '2px solid var(--border)',
            background: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: stopped ? 'none' : 'kwest-compass-spin 1.1s linear infinite',
          }}
        >
          <Compass size={48} style={{ color: 'var(--amber)' }} />
        </div>
      </div>
      <style>{`@keyframes kwest-compass-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <button className="btn btn-amber btn-block" style={{ minHeight: 44 }} disabled={disabled || stopped} onClick={handleStop}>
        Stop
      </button>
    </div>
  );
}
