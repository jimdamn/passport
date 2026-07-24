import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';
import { useAuth } from '../context/AuthContext';
import { MapPin, Trees, Trophy, Gem, Sparkles, Sprout, Pause, Compass, Signpost, Truck, UtensilsCrossed, PawPrint, type LucideIcon } from 'lucide-react';
import { Alert } from '../components/ui/Alert';
import {
  SUPPORT_CATEGORIES, SUPPORT_STATUS_LABEL, submitSupport, getMySupport,
  type SupportMessage,
} from '../api/support';

// ─── Section component ────────────────────────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{
        fontFamily: 'var(--font-serif)',
        fontSize: '1.25rem',
        fontWeight: 'bold',
        color: 'var(--green)',
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: '2px solid var(--border)',
      }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

// ─── Step indicator ─────────────────────────────────────────────────────────────────────────────────
function Step({ n, label, detail }: { n: number; label: string; detail: string }) {
  return (
    <div style={{ display: 'flex', gap: 14, marginBottom: 16, alignItems: 'flex-start' }}>
      <div style={{
        flexShrink: 0,
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'var(--green)',
        color: 'var(--cream)',
        fontFamily: 'var(--font-sans)',
        fontWeight: 700,
        fontSize: '0.9rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
      }}>
        {n}
      </div>
      <div>
        <p style={{ fontWeight: 'bold', marginBottom: 3, fontSize: '0.95rem' }}>{label}</p>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--muted)', lineHeight: 1.55 }}>
          {detail}
        </p>
      </div>
    </div>
  );
}

// ─── Tip card ─────────────────────────────────────────────────────────────────────────────────────
function Tip({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)',
      padding: '14px 16px',
      marginBottom: 12,
    }}>
      <p style={{ fontWeight: 'bold', marginBottom: 4 }}>
        <Icon size={15} style={{ color: 'var(--amber)', verticalAlign: '-2px', marginRight: 6 }} />{title}
      </p>
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--muted)', lineHeight: 1.55 }}>
        {body}
      </p>
    </div>
  );
}

// ─── Talk to us ───────────────────────────────────────────────────────────────────────────────────
// One-way member-to-admin channel. The email field is always shown and
// always optional, logged in or not - it's the admin's only reliable reply
// channel, so it's offered every time rather than inferred from account
// state. Logged-in members also see their own history below the form.
function ContactSection() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [category, setCategory] = useState<string>(SUPPORT_CATEGORIES[0].value);
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);

  function loadMessages() {
    if (!user || !tenant) return;
    getMySupport(tenant.id)
      .then(res => setMessages(res.data || []))
      .catch(() => setMessages([]));
  }

  useEffect(loadMessages, [user, tenant]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !tenant || !body.trim()) return;
    setBusy(true);
    setError('');
    setSent(false);
    try {
      await submitSupport(tenant.id, {
        category,
        body: body.trim(),
        email: email.trim() || undefined,
        route: window.location.pathname,
      });
      setBody('');
      setSent(true);
      loadMessages();
    } catch (err: any) {
      setError(
        err.message === 'rate_limited'
          ? 'Too many messages today. Try again tomorrow.'
          : err.message === 'invalid_email'
            ? "That doesn't look like a valid email."
            : 'Could not send that. Try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div id="contact" />
      <h2 style={{
        fontFamily: 'var(--font-serif)',
        fontSize: '1.25rem',
        fontWeight: 'bold',
        color: 'var(--green)',
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: '2px solid var(--border)',
      }}>
        Talk to Us
      </h2>
      <div className="card" style={{ background: 'var(--white)', padding: 16 }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>What's this about</label>
            <select
              className="form-select"
              value={category}
              onChange={e => setCategory(e.target.value)}
              style={{ minHeight: 38, width: '100%' }}
            >
              {SUPPORT_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Your email (optional)</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ minHeight: 38 }}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Message</label>
            <textarea
              className="form-textarea"
              required
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="What happened?"
              rows={4}
            />
          </div>
          {error && <Alert type="error">{error}</Alert>}
          {sent && <Alert type="success">Received. We read every message.</Alert>}
          <button type="submit" className="btn btn-amber" disabled={busy} style={{ minHeight: 40 }}>
            {busy ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>
      {messages.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {messages.map(m => (
            <div key={m.id} className="card" style={{ background: 'var(--white)', padding: '12px 16px' }}>
              <p style={{ margin: '0 0 4px', fontSize: '0.88rem', color: 'var(--text)' }}>
                {m.body.length > 80 ? `${m.body.slice(0, 80)}...` : m.body}
              </p>
              <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--muted)' }}>
                {new Date(m.created_at * 1000).toLocaleDateString()} · {SUPPORT_STATUS_LABEL[m.status]}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────────────────────────
export default function Help() {
  const { tenant } = useTenant();

  const brandName = tenant?.config.brand_name ?? 'Lake & Locals';
  const creditsName = tenant?.config.credits_name ?? 'KrowdKredits';

  return (
    <div className="main-content" style={{ maxWidth: 680, paddingTop: 24, paddingBottom: 80 }}>

      <div style={{ marginBottom: 8 }}>
        <Link to="/" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--muted)' }}>
          &larr; Back to Passport
        </Link>
      </div>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 className="page-title" style={{ fontFamily: 'var(--font-serif)', color: 'var(--green)', marginBottom: 8 }}>
          How the Passport Works
        </h1>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.95rem', color: 'var(--muted)', lineHeight: 1.6 }}>
          Welcome to the {brandName} Passport! This is a regional explorer card that rewards you for getting out and supporting the independent spots that make our community unique. By visiting member businesses, parks, and landmarks, you collect beautiful stamps and earn {creditsName} with a chance to win real regional prizes.
        </p>
      </div>

      {/* ── How to collect stamps ── */}
      <Section title="How to Collect Stamps">
        <Step
          n={1}
          label="Locate a QR Code"
          detail="Find scannable QR codes displayed at member restaurants, boutiques, farms, CSAs, state parks, and landmarks around the region."
        />
        <Step
          n={2}
          label="Scan with Your Phone"
          detail="Open your phone camera, scan the QR code, and open the secure platform scan link."
        />
        <Step
          n={3}
          label="Confirm Your Geolocation"
          detail="We verify you are physically standing at the merchant's station. This stops automated bots and ensures rewards go to real local residents!"
        />
        <Step
          n={4}
          label="Ink the Stamp & Win!"
          detail={`Unlock a beautiful illustrated stamp for your digital Passport and instantly roll the prize matrix to earn ${creditsName} or merchant rewards.`}
        />
      </Section>

      {/* ── Geofencing & Privacy ── */}
      <Section title="Privacy & The Geofence Shield">
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.92rem', lineHeight: 1.6, marginBottom: 16 }}>
          To build a reliable local network, we restrict stamp collection using a geofence. This ensures that every scan represents a real, physical interaction between neighbors and independent businesses.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          <div style={{
            background: 'var(--white)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: '12px 16px',
          }}>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', lineHeight: 1.55 }}>
              <strong>We never track your history.</strong> Browser location checks are done momentarily at the precise second you scan a QR code to verify presence. We do not track, share, or store your continuous location metrics.
            </p>
          </div>
          <div style={{
            background: 'var(--white)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: '12px 16px',
          }}>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', lineHeight: 1.55 }}>
              <strong>Anti-Gaming Shields.</strong> Thwarting internet-based bots and scans from home keeps the platform honest, preserving the real economic value of our Soft Currency rewards.
            </p>
          </div>
        </div>
      </Section>

      {/* ── The Prize Matrix ── */}
      <Section title="The Explorer Prize Matrix">
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.92rem', lineHeight: 1.6, marginBottom: 16 }}>
          Scanning a QR code isn't just about the stamp - it carries a guaranteed prize payout! Here is what's loaded into the regional prize matrix:
        </p>

        <div style={{
          background: 'var(--white)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          overflow: 'hidden',
          marginBottom: 16,
        }}>
          {[
            { action: 'Base Payout (minimum payout)', amount: '10 KrowdKredits' },
            { action: 'Local Merchant Coupons & Deals', amount: 'Active Discounts' },
            { action: 'Jackpot Windfalls (Rare)', amount: '500 - 1,000 Credits' },
            { action: 'Gift Certificates (Merchant specific)', amount: 'Varies' },
            { action: 'Cash Prizes (street events)', amount: '$100 cash on the spot' },
          ].map((row, i, arr) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', fontWeight: 600 }}>{row.action}</span>
              <span style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '0.82rem',
                fontWeight: 700,
                color: 'var(--amber)',
                whiteSpace: 'nowrap',
                marginLeft: 12,
              }}>
                {row.amount}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Hidden Treasure Chests ── */}
      <Section title="Hidden Treasure Chests">
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.92rem', lineHeight: 1.6, marginBottom: 16 }}>
          Every once in a while, just from browsing the Passport while signed in, a
          treasure chest bursts onto your screen. No scanning, no searching, no
          special page to visit. It simply finds you while you explore, and it
          always pays: every chest that appears carries real {creditsName}, deposited
          into your wallet on the spot.
        </p>
        <Tip
          icon={Gem}
          title="Every Chest Pays"
          body={`There are no empty chests. If one appears, you have already won - most hold 5 to 10 ${creditsName}, and lucky finds pay up to 25.`}
        />
        <Tip
          icon={Sparkles}
          title="Just Keep Exploring"
          body="Chests appear at random as you move between pages. There is no trick to summon one; browsing deals, happenings, and member pages like you normally would is the whole game."
        />
      </Section>

      {/* ── Your Around Town board ── */}
      <Section title="Your Around Town board">
        <Step
          n={1}
          label="Pick what you check most"
          detail="The first time you open Around Town, it asks what you check most - fresh food, events, deals. The board opens there for you, every visit."
        />
        <Step
          n={2}
          label="Read today's board"
          detail="Everything on it is happening now - a stand that posted this morning, music tonight, a deal this week. Tap anything to see more."
        />
        <Step
          n={3}
          label="Open the map"
          detail="Tap the little map for the full one. Amber pins have something going on today. Green pins are member places worth knowing."
        />
        <Tip
          icon={Compass}
          title="Change your picks"
          body="Your interests live on your profile - change them any time and the board follows."
        />
      </Section>

      {/* ── Lend a Hand ── */}
      <Section title="Lend a Hand: Volunteer Shifts">
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.92rem', lineHeight: 1.6, marginBottom: 16 }}>
          Local businesses sometimes need a few extra hands - event set-up, a work
          bee, a clean-up morning. Those shifts appear under Lend a Hand (from
          Around Town), and each carries a flat KrowdKredit thank-you.
        </p>
        <Step n={1} label="Claim a spot" detail="Open shifts show the when, the where, and the thank-you. One tap holds your spot; you can give it back any time before the shift." />
        <Step n={2} label="Show your QR when you arrive" detail="Your spot lives under My shifts with a QR code. The organizer scans it and your KrowdKredits land on the spot." />
        <Step n={3} label="Busy organizer? You're covered" detail="If a hectic event means nobody scanned you, don't worry - unconfirmed volunteers are resolved automatically within a few days of the event. Showing up is never wasted." />
      </Section>

      {/* ── Finding fresh food near you ── */}
      <Section title="Finding fresh food near you">
        <Step
          n={1}
          label="Open Fresh Today"
          detail="From Around Town, tap Fresh Today - everything on it was posted this morning."
        />
        <Step
          n={2}
          label="Check the map"
          detail="Amber pins have something out right now. Green pins are stands worth knowing about."
        />
        <Step
          n={3}
          label="Just show up"
          detail="Bring cash - most stands run a cash box. Sold out means somebody beat you to it."
        />
        <Tip
          icon={Sprout}
          title="The season strip"
          body="The line under the title tells you what's coming out of the fields this week - it changes all season."
        />
      </Section>

      {/* ── Running your stand on Fresh Today ── */}
      <Section title="Running your stand on Fresh Today">
        <Step
          n={1}
          label="Set up your stand once"
          detail="Name it, drag the pin to your spot, pick what you sell. About a minute."
        />
        <Step
          n={2}
          label="Post when things are out"
          detail="One line is plenty. Your post clears at the end of the day on its own."
        />
        <Step
          n={3}
          label="Tomorrow, one tap"
          detail="Yesterday's post shows an Out again today button - tap it and you're live."
        />
        <Tip
          icon={Pause}
          title="Going quiet for the season?"
          body="Pause your stand from My Stand - it keeps everything and hides you until spring."
        />
      </Section>

      {/* ── Finding sales near you ── */}
      <Section title="Finding sales near you">
        <Step
          n={1}
          label="Open Sale Day"
          detail="From Around Town, tap Sales - everything on the board is posted by neighbors."
        />
        <Step
          n={2}
          label="Check the map before you drive"
          detail="Amber pins are open right now. Green pins are coming up - tap one to see the days and hours."
        />
        <Step
          n={3}
          label="Look for the big weekends"
          detail="When a whole road or town runs sales together, you'll see it named at the top - tap it to see just those."
        />
        <Tip
          icon={Signpost}
          title="Done for today"
          body="Sellers mark when they've wrapped up, so you don't drive out to closed tables."
        />
      </Section>

      {/* ── Posting your sale ── */}
      <Section title="Posting your sale">
        <Step
          n={1}
          label="Post it once"
          detail="Title, what's there, your days and hours, and drag the pin to the driveway. About a minute."
        />
        <Step
          n={2}
          label="Wrap up when you're done"
          detail="Folding the tables early? One tap tells everyone - and if you're back tomorrow, the board says so."
        />
        <Step
          n={3}
          label="Rain? No problem"
          detail="Postpone hides your sale while you move the days, then Show puts it back."
        />
        <Tip
          icon={Signpost}
          title="Running it again"
          body="After your sale ends, one tap starts a new one with everything filled in - just pick the new days."
        />
      </Section>

      {/* ── Finding who's popped up ── */}
      <Section title="Finding who's popped up">
        <Step
          n={1}
          label="Open Pop-Ups"
          detail="From Around Town, tap Pop-Ups - food trucks, pop-up shops and traveling vendors, posted by the folks running them."
        />
        <Step
          n={2}
          label="Green means go"
          detail="Green pins have checked in - they're standing there right now, at that exact spot. Amber is their schedule - a plan, and plans change."
        />
        <Step
          n={3}
          label="Follow your favorites"
          detail="Tap any vendor to see everywhere they'll be. Share their page so your people can find them too."
        />
        <Tip
          icon={Truck}
          title="Sold out happens"
          body="The good ones run out. Sold out means you found them too late - their schedule tells you where they'll be next."
        />
      </Section>

      {/* ── Putting your schedule on the map ── */}
      <Section title="Putting your schedule on the map">
        <Step
          n={1}
          label="Set up your page once"
          detail="Your name, what you are, a photo. No address - you're the address."
        />
        <Step
          n={2}
          label="Post your stops"
          detail="Date, hours, drag the pin, say where to look. Post the whole week at once if your circuit's set."
        />
        <Step
          n={3}
          label="Check in when you're set up"
          detail="One tap on I'm here turns your pin green and drops it on your exact spot. Green is what fans trust - it's the difference between 'planned' and 'there.'"
        />
        <Tip
          icon={Truck}
          title="On the day"
          body="Tap Sold out when you're cleaned out - fans respect it. Next week, Stop here again fills everything in."
        />
      </Section>

      {/* ── Finding a meal near you ── */}
      <Section title="Finding a meal near you">
        <Step
          n={1}
          label="Open Community Table"
          detail="From Around Town, tap Meals - fish fries, breakfasts, suppers and benefits, all posted by the folks cooking them."
        />
        <Step
          n={2}
          label="Check who it helps"
          detail="Most meals raise money for something - new gear, a scholarship, a neighbor going through a hard time. It says so right on the card."
        />
        <Step
          n={3}
          label="Show up hungry"
          detail="Bring cash - most doors run a cash box. Sold out means the town showed up before you."
        />
        <Tip
          icon={UtensilsCrossed}
          title="Cancelled happens"
          body="Weather and life get in the way. A cancelled meal stays on the board with a Cancelled mark so nobody drives out for nothing."
        />
      </Section>

      {/* ── Putting your kitchen on the board ── */}
      <Section title="Putting your kitchen on the board">
        <Step
          n={1}
          label="Set up your kitchen once"
          detail="Name it, drag the pin to the hall, done. Works for fire departments, churches, clubs and anyone cooking for a cause."
        />
        <Step
          n={2}
          label="Post each meal"
          detail="Date, serving times, what's cooking and what it costs, and who it helps. Post the whole season at once if you like."
        />
        <Step
          n={3}
          label="On the day"
          detail="Tap Sold out when the food's gone - folks respect it. Next time, Serve it again fills everything in."
        />
        <Tip
          icon={UtensilsCrossed}
          title="Between seasons?"
          body="Go quiet from My Kitchen - it keeps everything and hides you until you're cooking again."
        />
      </Section>

      {/* ── If you've lost a pet ── */}
      <Section title="If you've lost a pet">
        <Step
          n={1}
          label="Post it fast"
          detail="A photo, where they were last seen, your number. Minutes matter more than perfect words."
        />
        <Step
          n={2}
          label="Share the link"
          detail="Post it to any Facebook group, text it to anyone - the card carries the photo and a map. Every share is another set of eyes."
        />
        <Step
          n={3}
          label="When the phone rings"
          detail="Ask the caller to describe something you left out of the post - a marking, the collar. Good neighbors won't mind, and it keeps the rare bad actor away."
        />
        <Tip
          icon={PawPrint}
          title="Don't give up at 30 days"
          body="The board asks once a month if you're still looking - one tap keeps the post out there. Pets come home after months. Mark it Home safe when they do - the whole region gets to see the good ending."
        />
      </Section>

      {/* ── If you've found one ── */}
      <Section title="If you've found one">
        <Step
          n={1}
          label="Keep them safe, then post"
          detail="A found post takes a minute and it's often faster than the pet's family thinking to look. No collar? Post anyway."
        />
        <Step
          n={2}
          label="Get them scanned - it's free"
          detail="Any vet or shelter will scan for a microchip at no charge, no appointment usually needed. It's the fastest way home there is."
        />
        <Step
          n={3}
          label="Hand them back smart"
          detail="Ask for a photo of the pet or a vet record before handing them over. Real owners have plenty of both."
        />
        <Tip
          icon={PawPrint}
          title="Check the amber pins"
          body="Somebody may already be looking for exactly who's in your garage - check the Lost posts before you post, and call the number if it matches."
        />
      </Section>

      {/* ── Deferred claims ── */}
      <Section title="Street Scans & Deferred Claims">
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.92rem', lineHeight: 1.6, marginBottom: 16 }}>
          Made a winning scan in the middle of a parade or crowded event? You don't have to stop and create an account in a crowd. We've designed a **frictionless deferred claim flow**:
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          <div style={{
            background: 'var(--white)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: '14px 16px',
          }}>
            <p style={{ fontWeight: 'bold', marginBottom: 4 }}>1. Scan &amp; Win Instantly</p>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.87rem', color: 'var(--muted)', lineHeight: 1.5 }}>
              Scan the street team QR code. You instantly see your prize and receive a 7-day `claim_token` code without needing to log in.
            </p>
          </div>
          <div style={{
            background: 'var(--white)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: '14px 16px',
          }}>
            <p style={{ fontWeight: 'bold', marginBottom: 4 }}>2. Secure Your Reward Slot</p>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.87rem', color: 'var(--muted)', lineHeight: 1.5 }}>
              Simply input one field - your phone or email. We immediately link your claim token and queue a secure claim OTP link.
            </p>
          </div>
          <div style={{
            background: 'var(--white)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: '14px 16px',
          }}>
            <p style={{ fontWeight: 'bold', marginBottom: 4 }}>3. Claim at Home Later</p>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.87rem', color: 'var(--muted)', lineHeight: 1.5 }}>
              Once you get home, click the link and register a free, passwordless profile (only 3 fields, no passwords to remember). The system immediately deposits all earned stamps and credits into your wallet!
            </p>
          </div>
        </div>
      </Section>

      {/* ── Tips ── */}
      <Section title="Explorer Tips for Getting the Most Out of the Passport">
        <Tip
          icon={MapPin}
          title="Daily Cooldown Limits"
          body="To prevent farming, you can collect from any single scannable merchant QR code once every 24 hours. But you are fully encouraged to visit as many different locations in the same day as you'd like!"
        />
        <Tip
          icon={Trees}
          title="Diversify Your Stamps"
          body="Explore different categories like Dining, Boutiques, CSAs, and State Parks. Unlocking stamps in every area represents a true regional contributor!"
        />
        <Tip
          icon={Trophy}
          title="Watch for Milestones"
          body="Our automatic badge engine monitors your accumulated scans and credit gains. Crossing thresholds automatically unlocks milestones like the 'Welcome Explorer' and 'Century Club' badges!"
        />
      </Section>

      {/* ── Footer CTA ── */}
      <div style={{
        background: 'var(--green)',
        borderRadius: 'var(--r-lg)',
        padding: '24px 20px',
        textAlign: 'center',
      }}>
        <p style={{
          fontFamily: 'var(--font-serif)',
          color: 'var(--cream)',
          fontWeight: 'bold',
          fontSize: '1.05rem',
          marginBottom: 8,
        }}>
          Ready to scan your first stamp?
        </p>
        <p style={{
          fontFamily: 'var(--font-sans)',
          color: 'rgba(244,241,234,0.7)',
          fontSize: '0.87rem',
          marginBottom: 16,
          lineHeight: 1.5,
        }}>
          Look for scannable QR codes displayed at member merchants or parade street teams across your region!
        </p>
        <Link to="/my-stamps" className="btn btn-amber">
          My Passport Stamps
        </Link>
      </div>

      <div style={{ marginTop: 32 }}>
        <ContactSection />
      </div>

    </div>
  );
}
