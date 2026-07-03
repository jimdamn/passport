import { Link } from 'react-router-dom';
import { useTenant } from '../context/TenantContext';

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
function Tip({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)',
      padding: '14px 16px',
      marginBottom: 12,
    }}>
      <p style={{ fontWeight: 'bold', marginBottom: 4 }}>
        <span style={{ marginRight: 6 }}>{icon}</span>{title}
      </p>
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--muted)', lineHeight: 1.55 }}>
        {body}
      </p>
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
          icon="📍"
          title="Daily Cooldown Limits"
          body="To prevent farming, you can collect from any single scannable merchant QR code once every 24 hours. But you are fully encouraged to visit as many different locations in the same day as you'd like!"
        />
        <Tip
          icon="🌲"
          title="Diversify Your Stamps"
          body="Explore different categories like Dining, Boutiques, CSAs, and State Parks. Unlocking stamps in every area represents a true regional contributor!"
        />
        <Tip
          icon="🏆"
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

    </div>
  );
}
