import { FlaskConical } from 'lucide-react';

interface Props {
  onReset: () => void;
  resetting: boolean;
}

// Persistent amber banner shown while an admin plays their own test run -
// awards and notifications are suppressed server-side and finishes never
// touch the real rank index, but the UI should never let a test-run feel
// like the real thing (dev plan Section 7a).
export default function TestModeRibbon({ onReset, resetting }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      background: 'rgba(200,134,10,0.12)', border: '1px solid var(--amber)', borderRadius: 'var(--r-md)',
      padding: '8px 14px', marginBottom: 16, fontSize: '0.8rem', fontWeight: 600, color: 'var(--amber)',
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <FlaskConical size={14} /> TEST MODE - awards and notifications are suppressed
      </span>
      <button className="btn btn-secondary btn-sm" style={{ minHeight: 28, fontSize: '0.75rem' }} disabled={resetting} onClick={onReset}>
        {resetting ? 'Resetting...' : 'Reset'}
      </button>
    </div>
  );
}
