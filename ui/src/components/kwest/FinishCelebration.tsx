import { Trophy, Award, Medal, Sparkles } from 'lucide-react';
import type { KwestRevealResult } from '../../api/kwest';

interface Props {
  open: boolean;
  result: KwestRevealResult | null;
  creditsName: string;
  onOpenDisplayChoice: () => void;
  onDone: () => void;
}

function tierCopy(result: KwestRevealResult, creditsName: string) {
  if (result.prize_kind === 'grand') {
    return {
      icon: Trophy,
      title: "You're in first place",
      body: `We will be in touch soon about claiming your grand prize${result.grand_prize_description ? ` - ${result.grand_prize_description}` : ''}, plus ${result.prize_kredits ?? 0} ${creditsName}. A valid photo ID will confirm it's you.`,
    };
  }
  if (result.prize_kind === 'kk_rank') {
    return {
      icon: Award,
      title: `You finished in rank ${result.rank}`,
      body: `${result.prize_kredits ?? 0} ${creditsName} just landed in your account.`,
    };
  }
  if (result.prize_kind === 'kk_consolation') {
    return {
      icon: Medal,
      title: `You finished in rank ${result.rank}`,
      body: `${result.prize_kredits ?? 0} ${creditsName} just landed in your account.`,
    };
  }
  return {
    icon: Sparkles,
    title: 'You made it to the end',
    body: 'All the prize spots were already claimed, but the trail was still worth it.',
  };
}

// Full-screen finish overlay - echoes the KKAuth fullscreen chest toast the
// server also fires, but renders instantly in-app (no poll latency).
export default function FinishCelebration({ open, result, creditsName, onOpenDisplayChoice, onDone }: Props) {
  if (!open || !result) return null;
  const { icon: Icon, title, body } = tierCopy(result, creditsName);
  const isWinner = result.rank != null && result.rank <= 20;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(30,51,32,0.7)', zIndex: 260,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div className="card" style={{ background: 'var(--white)', padding: 32, maxWidth: 380, width: '100%', textAlign: 'center' }}>
        <Icon size={44} style={{ color: 'var(--amber)', marginBottom: 12 }} />
        <h2 style={{ margin: '0 0 10px', fontSize: '1.3rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
          {title}
        </h2>
        <p style={{ margin: '0 0 24px', fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.55 }}>
          {body}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isWinner && (
            <button className="btn btn-secondary btn-block" style={{ minHeight: 44 }} onClick={onOpenDisplayChoice}>
              How should we list you?
            </button>
          )}
          <button className="btn btn-amber btn-block" style={{ minHeight: 44 }} onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
