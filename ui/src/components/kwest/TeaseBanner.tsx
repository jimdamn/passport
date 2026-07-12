import { Sparkles } from 'lucide-react';

interface Props {
  tease: string;
  onPlay: () => void;
  onDecline: () => void;
}

// The offer stage inside MiniGameShell - a rare, random extra after a
// non-final hit. Declining just lets the offer expire on its own (30 min);
// there's nothing to lose by saying not now.
export default function TeaseBanner({ tease, onPlay, onDecline }: Props) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 4px' }}>
      <Sparkles size={32} style={{ color: 'var(--amber)', marginBottom: 12 }} />
      <p style={{ margin: '0 0 24px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        {tease}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button className="btn btn-amber btn-block" style={{ minHeight: 44 }} onClick={onPlay}>
          Take a look
        </button>
        <button className="btn btn-secondary btn-block" style={{ minHeight: 44 }} onClick={onDecline}>
          Not now
        </button>
      </div>
    </div>
  );
}
