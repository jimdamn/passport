import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import {
  getKwestHunt, getKwestRules, startKwest, ackKwest, getKwestState, revealKwest,
  attachKwestGuest, setKwestDisplayChoice, playKwestMinigame, getGuestToken, setGuestToken,
  type KwestHuntDetail, type KwestRules, type KwestStateResult, type KwestRevealResult, type Clue,
  type MinigameOffer,
} from '../../api/kwest';
import AckModal from '../../components/kwest/AckModal';
import RulesModal from '../../components/kwest/RulesModal';
import StepCelebration from '../../components/kwest/StepCelebration';
import FinishCelebration from '../../components/kwest/FinishCelebration';
import DisplayChoiceDrawer from '../../components/kwest/DisplayChoiceDrawer';
import MiniGameShell from '../../components/kwest/MiniGameShell';
import { Spinner } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { Compass, MonitorSmartphone, CloudRain, PartyPopper, ScrollText, LocateFixed } from 'lucide-react';

function ClueList({ clues }: { clues: Clue[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {clues.map((clue, i) => (
        <p key={i} style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: '0.95rem', lineHeight: 1.6, color: 'var(--text)' }}>
          {clue.body}
        </p>
      ))}
    </div>
  );
}

export default function KwestHunt() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const creditsName = tenant?.config.credits_name ?? 'KrowdKredits';

  const [hunt, setHunt] = useState<KwestHuntDetail | null>(null);
  const [rules, setRules] = useState<KwestRules | null>(null);
  const [state, setState] = useState<KwestStateResult | null>(null);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [showAck, setShowAck] = useState(false);
  const [agreeing, setAgreeing] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [revealing, setRevealing] = useState(false);

  const [finishResult, setFinishResult] = useState<KwestRevealResult | null>(null);
  const [showFinishCelebration, setShowFinishCelebration] = useState(false);
  const [showDisplayChoice, setShowDisplayChoice] = useState(false);
  const [stepReward, setStepReward] = useState(0);
  const [showStepCelebration, setShowStepCelebration] = useState(false);
  const [pendingMinigameOffer, setPendingMinigameOffer] = useState<MinigameOffer | null>(null);
  const [showMinigame, setShowMinigame] = useState(false);

  const attaching = useRef(false);

  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768;
  const hasGeolocation = typeof navigator !== 'undefined' && !!navigator.geolocation;
  const canPlay = !isDesktop && hasGeolocation;

  const tenantId = tenant.id;

  async function loadState() {
    if (!slug) return;
    try {
      const res = await getKwestState(tenantId, slug);
      setState(res.data);
      setStarted(true);
      if (res.data.needs_ack) setShowAck(true);
    } catch {
      setStarted(false);
    }
  }

  // Load hunt detail + rules once; try to resume existing progress.
  useEffect(() => {
    if (!slug || !tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [huntRes, rulesRes] = await Promise.all([
          getKwestHunt(tenantId, slug),
          getKwestRules(tenantId, slug),
        ]);
        if (cancelled) return;
        setHunt(huntRes.data);
        setRules(rulesRes.data);
        await loadState();
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Could not load this hunt.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, tenantId]);

  // A guest who signed in mid-hunt: migrate their progress onto the account,
  // then reload state as the now-authenticated player.
  useEffect(() => {
    if (!user || !tenantId) return;
    const guestToken = getGuestToken();
    if (!guestToken || attaching.current) return;
    attaching.current = true;
    (async () => {
      try {
        await attachKwestGuest(tenantId, guestToken);
      } catch {
        // best-effort - if the token was already invalid, there's nothing to migrate
      } finally {
        setGuestToken(null);
        await loadState();
        attaching.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenantId]);

  const handleStart = async () => {
    if (!slug) return;
    setError('');
    try {
      const res = await startKwest(tenantId, slug);
      if (res.data.blocked) {
        setMessage(res.data.message || 'This hunt is not open yet.');
        return;
      }
      if (res.data.guest_token) setGuestToken(res.data.guest_token);
      setStarted(true);
      if (res.data.needs_ack) setShowAck(true);
      else await loadState();
    } catch (err: any) {
      setError(err.message || 'Could not start the hunt.');
    }
  };

  const handleAgree = async () => {
    if (!slug) return;
    setAgreeing(true);
    try {
      await ackKwest(tenantId, slug);
      setShowAck(false);
      await loadState();
    } catch (err: any) {
      setError(err.message || 'Could not record your agreement.');
    } finally {
      setAgreeing(false);
    }
  };

  const handleReveal = () => {
    if (!slug || acquiring || revealing) return;
    setError('');
    setMessage('');
    setAcquiring(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setAcquiring(false);
        setRevealing(true);
        try {
          const res = await revealKwest(tenantId, slug, {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          });
          await handleRevealResponse(res.data);
        } catch (err: any) {
          setError(err.message || 'Could not check your location right now.');
        } finally {
          setRevealing(false);
        }
      },
      () => {
        setAcquiring(false);
        setError('We could not get your location. Check that location access is allowed for this site, then try again.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  async function handleRevealResponse(data: KwestRevealResult) {
    if (data.blocked === 'ack_required') { setShowAck(true); return; }
    if (data.blocked) { setMessage(data.message || 'This hunt is paused right now.'); return; }

    if (data.result === 'near' || data.result === 'miss') {
      setMessage(data.message || 'Not quite.');
      return;
    }

    if (data.result === 'hit') {
      if (data.finish_pending_auth) {
        setMessage("You found it! Sign in to claim your finish, then tap Reveal again once you're back.");
        return;
      }
      if (data.finished) {
        setFinishResult(data);
        setShowFinishCelebration(true);
        return;
      }
      setStepReward(data.step_reward ?? 0);
      setPendingMinigameOffer(data.minigame_offer ?? null);
      setShowStepCelebration(true);
    }
  }

  const handleStepContinue = async () => {
    setShowStepCelebration(false);
    if (pendingMinigameOffer) {
      setShowMinigame(true);
    } else {
      await loadState();
    }
  };

  const handleMinigameClose = async () => {
    setShowMinigame(false);
    setPendingMinigameOffer(null);
    await loadState();
  };

  const handlePlayMinigame = async (offerId: string, input: unknown) => {
    const res = await playKwestMinigame(tenantId, offerId, input);
    return res.data;
  };

  const handleChooseDisplay = async (choice: 'anonymous' | 'real') => {
    if (!slug) return;
    await setKwestDisplayChoice(tenantId, slug, choice);
  };

  if (loading) {
    return (
      <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!hunt) {
    return (
      <div className="main-content" style={{ paddingTop: 24 }}>
        <Alert type="error">{error || 'This hunt could not be found.'}</Alert>
      </div>
    );
  }

  return (
    <div className="main-content" style={{ maxWidth: 640, paddingTop: 20, paddingBottom: 80 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Compass size={22} style={{ color: 'var(--amber)' }} /> {hunt.name}
      </h1>
      {hunt.location_label && (
        <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--muted)' }}>{hunt.location_label}</p>
      )}

      <p style={{ margin: '0 0 16px', fontFamily: 'var(--font-sans)', fontSize: '0.92rem', lineHeight: 1.6, color: 'var(--text)' }}>
        {hunt.narrative}
      </p>

      {hunt.weather_paused && (
        <Alert type="info" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CloudRain size={16} /> This hunt is paused for weather right now, as a safety courtesy. Check back soon.
        </Alert>
      )}
      {hunt.all_prizes_claimed && (
        <Alert type="info" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <PartyPopper size={16} /> All the prize spots for this hunt have been claimed - you're playing for fun now.
        </Alert>
      )}

      <button
        onClick={() => setShowRules(true)}
        className="btn btn-secondary btn-sm"
        style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 20 }}
      >
        <ScrollText size={14} /> Official Rules
      </button>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {message && <Alert type="info" style={{ marginBottom: 16 }}>{message}</Alert>}

      {!canPlay ? (
        <div className="card" style={{ background: 'var(--white)', padding: 24 }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px', fontWeight: 600, color: 'var(--green)' }}>
            <MonitorSmartphone size={18} style={{ color: 'var(--amber)' }} /> Non-mobile devices cannot be used for the game
          </p>
          <p style={{ margin: '0 0 16px', fontSize: '0.88rem', color: 'var(--muted)', lineHeight: 1.55 }}>
            KrowdKwest is played by traveling to real places and confirming your presence with your phone's location.
            Come back on a GPS-capable mobile device to play - for now, here is the first clue.
          </p>
          {hunt.first_clue && <ClueList clues={hunt.first_clue} />}
        </div>
      ) : !started ? (
        hunt.status === 'live' ? (
          <div className="card" style={{ background: 'var(--white)', padding: 24, textAlign: 'center' }}>
            <button className="btn btn-amber btn-block" style={{ minHeight: 44 }} onClick={handleStart}>
              Start the hunt
            </button>
          </div>
        ) : (
          <Alert type="info">This hunt is not open yet.</Alert>
        )
      ) : state?.finished ? (
        <div className="card" style={{ background: 'var(--white)', padding: 24, textAlign: 'center' }}>
          <PartyPopper size={28} style={{ color: 'var(--amber)', marginBottom: 8 }} />
          <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--text)' }}>You've already finished this hunt. Thanks for playing.</p>
          <Link to={`/kwest/${slug}/retro`} className="btn btn-secondary btn-sm" style={{ minHeight: 34, marginTop: 16, display: 'inline-block' }}>
            See the winners
          </Link>
        </div>
      ) : state && state.clues ? (
        <div className="card" style={{ background: 'var(--white)', padding: 20 }}>
          <ClueList clues={state.clues} />
          {state.hint && (
            <p style={{ marginTop: 14, marginBottom: 0, fontSize: '0.85rem', color: 'var(--amber)', fontStyle: 'italic' }}>
              Hint: {state.hint}
            </p>
          )}
          {!user && state.is_final && (
            <Alert type="info" style={{ marginTop: 16 }}>
              Sign in before your final find so your finish counts the moment you arrive.{' '}
              <Link to={`/auth/login?return_to=/kwest/${slug}`} style={{ fontWeight: 600, color: 'var(--green)' }}>Sign in</Link>
            </Alert>
          )}
          <button
            className="btn btn-amber btn-block"
            style={{ minHeight: 48, marginTop: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            disabled={acquiring || revealing}
            onClick={handleReveal}
          >
            <LocateFixed size={18} />
            {acquiring ? 'Finding your location...' : revealing ? 'Checking...' : 'Reveal'}
          </button>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 24 }}><Spinner /></div>
      )}

      <AckModal open={showAck} huntName={hunt.name} rules={rules} onAgree={handleAgree} agreeing={agreeing} />
      <RulesModal open={showRules} onClose={() => setShowRules(false)} rules={rules} />
      <StepCelebration open={showStepCelebration} reward={stepReward} creditsName={creditsName} onContinue={handleStepContinue} />
      {showMinigame && pendingMinigameOffer && (
        <MiniGameShell
          open={showMinigame}
          offer={pendingMinigameOffer}
          creditsName={creditsName}
          onClose={handleMinigameClose}
          onPlay={handlePlayMinigame}
        />
      )}
      <FinishCelebration
        open={showFinishCelebration}
        result={finishResult}
        creditsName={creditsName}
        onOpenDisplayChoice={() => setShowDisplayChoice(true)}
        onDone={() => { setShowFinishCelebration(false); loadState(); }}
      />
      {finishResult?.display_prompt && (
        <DisplayChoiceDrawer
          open={showDisplayChoice}
          onClose={() => setShowDisplayChoice(false)}
          defaultChoice={finishResult.display_prompt.default_choice}
          realName={finishResult.display_prompt.real_name}
          anonymousName={finishResult.display_prompt.anonymous_name}
          onChoose={handleChooseDisplay}
        />
      )}
    </div>
  );
}
