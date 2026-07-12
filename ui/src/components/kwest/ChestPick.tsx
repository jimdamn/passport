import { useState } from 'react';
import { Package } from 'lucide-react';

interface Props {
  onSubmit: (input: { chest: 0 | 1 | 2 }) => void;
  disabled: boolean;
}

// One-thumb choice: three closed chests, tap one to open it. The server has
// already decided the outcome by the time this renders - the chosen index
// is presentation only.
export default function ChestPick({ onSubmit, disabled }: Props) {
  const [picked, setPicked] = useState<0 | 1 | 2 | null>(null);

  const handlePick = (i: 0 | 1 | 2) => {
    if (disabled || picked !== null) return;
    setPicked(i);
    onSubmit({ chest: i });
  };

  return (
    <div style={{ textAlign: 'center' }}>
      <p style={{ margin: '0 0 20px', fontSize: '0.9rem', color: 'var(--muted)' }}>Pick a chest</p>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            onClick={() => handlePick(i as 0 | 1 | 2)}
            disabled={disabled || picked !== null}
            style={{
              width: 84, height: 84, borderRadius: 'var(--r-md)',
              background: picked === i ? 'var(--amber)' : 'var(--white)',
              border: picked === i ? '2px solid var(--amber)' : '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: disabled || picked !== null ? 'default' : 'pointer',
              transition: 'transform 0.15s',
              transform: picked === i ? 'scale(1.05)' : 'scale(1)',
            }}
          >
            <Package size={36} style={{ color: picked === i ? 'var(--white)' : 'var(--green)' }} />
          </button>
        ))}
      </div>
    </div>
  );
}
