import { CheckCircle2 } from 'lucide-react';

interface Props {
  open: boolean;
  reward: number;
  creditsName: string;
  onContinue: () => void;
}

// Instant in-app celebration for a solved (non-final) step - no toast-poll
// lag, renders the moment the reveal response comes back.
export default function StepCelebration({ open, reward, creditsName, onContinue }: Props) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(30,51,32,0.55)', zIndex: 250,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div className="card" style={{ background: 'var(--white)', padding: 28, maxWidth: 340, width: '100%', textAlign: 'center' }}>
        <CheckCircle2 size={36} style={{ color: 'var(--amber)', marginBottom: 10 }} />
        <h2 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
          You found it
        </h2>
        {reward > 0 && (
          <p style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, margin: '0 0 16px',
            fontSize: '0.95rem', fontWeight: 700, color: 'var(--amber)',
            background: 'rgba(200,134,10,0.1)', padding: '6px 14px', borderRadius: 'var(--r-pill)',
          }}>
            +{reward} {creditsName}
          </p>
        )}
        <button className="btn btn-amber btn-block" style={{ minHeight: 44 }} onClick={onContinue}>
          On to the next clue
        </button>
      </div>
    </div>
  );
}
