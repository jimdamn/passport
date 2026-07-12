import { useEffect, useState } from 'react';
import { Gift, Sparkles } from 'lucide-react';
import TeaseBanner from './TeaseBanner';
import ChestPick from './ChestPick';
import CompassStop from './CompassStop';
import ScratchOff from './ScratchOff';
import type { MinigameOffer } from '../../api/kwest';

interface PlayResult {
  outcome: string;
  outcome_kredits?: number;
}

interface Props {
  open: boolean;
  offer: MinigameOffer;
  creditsName: string;
  onClose: () => void;
  onPlay: (offerId: string, input: unknown) => Promise<PlayResult>;
}

type Stage = 'tease' | 'playing' | 'result';

// The rare mini-game extra offered after a non-final hit. Tease -> game ->
// result, one thumb, no more than a few seconds - the interaction is
// presentation only, the server already decided.
export default function MiniGameShell({ open, offer, creditsName, onClose, onPlay }: Props) {
  const [stage, setStage] = useState<Stage>('tease');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PlayResult | null>(null);

  useEffect(() => {
    if (open) { setStage('tease'); setResult(null); setSubmitting(false); }
  }, [open, offer.offer_id]);

  const handleSubmit = async (input: unknown) => {
    setSubmitting(true);
    try {
      const res = await onPlay(offer.offer_id, input);
      setResult(res);
      setStage('result');
    } catch {
      setResult({ outcome: 'error' });
      setStage('result');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(30,51,32,0.6)', zIndex: 270,
        display: open ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div className="card" style={{ background: 'var(--white)', padding: 28, maxWidth: 360, width: '100%' }}>
        {stage === 'tease' && (
          <TeaseBanner tease={offer.tease} onPlay={() => setStage('playing')} onDecline={onClose} />
        )}

        {stage === 'playing' && (
          <>
            {offer.game === 'chest_pick' && <ChestPick onSubmit={handleSubmit} disabled={submitting} />}
            {offer.game === 'compass_stop' && <CompassStop onSubmit={handleSubmit} disabled={submitting} />}
            {offer.game === 'scratch_off' && <ScratchOff onSubmit={handleSubmit} disabled={submitting} />}
          </>
        )}

        {stage === 'result' && (
          <div style={{ textAlign: 'center' }}>
            {result && result.outcome_kredits ? (
              <>
                <Gift size={32} style={{ color: 'var(--amber)', marginBottom: 10 }} />
                <p style={{ margin: '0 0 6px', fontSize: '1.05rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
                  You found something
                </p>
                <p style={{
                  display: 'inline-flex', margin: '0 0 20px', fontSize: '0.92rem', fontWeight: 700, color: 'var(--amber)',
                  background: 'rgba(200,134,10,0.1)', padding: '6px 14px', borderRadius: 'var(--r-pill)',
                }}>
                  +{result.outcome_kredits} {creditsName}
                </p>
              </>
            ) : (
              <>
                <Sparkles size={32} style={{ color: 'var(--muted)', marginBottom: 10 }} />
                <p style={{ margin: '0 0 20px', fontSize: '0.95rem', color: 'var(--text)' }}>
                  Not this time - the trail goes on.
                </p>
              </>
            )}
            <button className="btn btn-amber btn-block" style={{ minHeight: 44 }} onClick={onClose}>
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
