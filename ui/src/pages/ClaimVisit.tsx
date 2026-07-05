import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { api } from '../api/client';
import type { ApiResponse } from '../types';

/**
 * P-1: land here from a paid receipt's "Earn KrowdKredits in Passport"
 * button (?token= is the Business Hub's signed 24h visit token). Signed-in
 * users claim automatically; signed-out visitors get a login door that
 * brings them straight back. Friendly states, never error walls.
 */

interface ClaimResult {
  status: 'claimed' | 'already_yours' | 'already_claimed' | 'expired';
  business_name?: string;
  credits_awarded?: number;
  credits_balance?: number;
  new_badges?: string[];
}

export default function ClaimVisit() {
  const [searchParams] = useSearchParams();
  const visitToken = searchParams.get('token') ?? '';
  const { user, token } = useAuth();
  const { tenant } = useTenant();

  const [result, setResult] = useState<ClaimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const attempted = useRef(false);

  const creditsName = tenant?.config?.credits_name ?? 'KrowdKredits';

  useEffect(() => {
    if (!user || !token || !tenant || !visitToken || attempted.current) return;
    attempted.current = true;
    setClaiming(true);
    api
      .post<ApiResponse<ClaimResult>>(`/t/${tenant.id}/claim/visit`, { token: visitToken })
      .then((res) => setResult(res.data))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not record your visit.'))
      .finally(() => setClaiming(false));
  }, [user, token, tenant, visitToken]);

  const shell = (inner: React.ReactNode) => (
    <div style={{ maxWidth: 480, margin: '40px auto', padding: '0 16px', textAlign: 'center' }}>
      <div className="card" style={{ padding: '32px 24px' }}>{inner}</div>
    </div>
  );

  if (!visitToken) {
    return shell(
      <>
        <h1 className="page-title" style={{ marginBottom: 8 }}>Nothing to claim here</h1>
        <p style={{ color: 'var(--muted)' }}>
          This page works from the link on a paid receipt. Shop local, and the
          receipt brings you back.
        </p>
        <Link to="/" className="btn btn-amber" style={{ marginTop: 16, display: 'inline-block' }}>Explore Passport</Link>
      </>,
    );
  }

  if (!user) {
    const returnTo = `/claim/visit?token=${encodeURIComponent(visitToken)}`;
    return shell(
      <>
        <h1 className="page-title" style={{ marginBottom: 8 }}>Your visit is worth {creditsName}</h1>
        <p style={{ color: 'var(--muted)' }}>
          Sign in and this purchase earns you {creditsName} - our thank-you for
          keeping money in the neighborhood.
        </p>
        <Link to={`/auth/login?return_to=${encodeURIComponent(returnTo)}`}
              className="btn btn-amber" style={{ marginTop: 16, display: 'inline-block' }}>
          Sign in to claim
        </Link>
      </>,
    );
  }

  if (claiming || (!result && !error)) {
    return shell(<p style={{ color: 'var(--muted)' }}>Recording your visit…</p>);
  }

  if (error) {
    return shell(
      <>
        <h1 className="page-title" style={{ marginBottom: 8 }}>One moment</h1>
        <p style={{ color: 'var(--muted)' }}>{error}</p>
        <button className="btn btn-amber" style={{ marginTop: 16 }}
                onClick={() => { attempted.current = false; setError(null); setResult(null); window.location.reload(); }}>
          Try again
        </button>
      </>,
    );
  }

  const r = result!;
  if (r.status === 'claimed') {
    return shell(
      <>
        <h1 className="page-title" style={{ marginBottom: 8 }}>
          {r.credits_awarded ? `+${r.credits_awarded} ${creditsName}` : 'Visit recorded'}
        </h1>
        <p style={{ color: 'var(--muted)' }}>
          Thanks for supporting {r.business_name ?? 'a local business'} - that
          purchase stayed in the neighborhood, and this is the neighborhood
          saying thanks back.
        </p>
        {typeof r.credits_balance === 'number' && r.credits_balance > 0 && (
          <p style={{ marginTop: 10 }}>Your balance: <strong>{r.credits_balance} {creditsName}</strong></p>
        )}
        <Link to="/profile" className="btn btn-amber" style={{ marginTop: 16, display: 'inline-block' }}>See my {creditsName}</Link>
      </>,
    );
  }
  if (r.status === 'already_yours') {
    return shell(
      <>
        <h1 className="page-title" style={{ marginBottom: 8 }}>Already counted</h1>
        <p style={{ color: 'var(--muted)' }}>
          You claimed this visit to {r.business_name ?? 'this business'} before - it's
          safely on your record.
        </p>
        <Link to="/profile" className="btn btn-amber" style={{ marginTop: 16, display: 'inline-block' }}>See my {creditsName}</Link>
      </>,
    );
  }
  if (r.status === 'already_claimed') {
    return shell(
      <>
        <h1 className="page-title" style={{ marginBottom: 8 }}>Already claimed</h1>
        <p style={{ color: 'var(--muted)' }}>
          This receipt was already used to claim {creditsName}. Each purchase
          counts once.
        </p>
        <Link to="/" className="btn btn-amber" style={{ marginTop: 16, display: 'inline-block' }}>Explore Passport</Link>
      </>,
    );
  }
  return shell(
    <>
      <h1 className="page-title" style={{ marginBottom: 8 }}>This link has expired</h1>
      <p style={{ color: 'var(--muted)' }}>
        Visit links work for 24 hours after a purchase. The visit still
        happened - and the next one will count.
      </p>
      <Link to="/" className="btn btn-amber" style={{ marginTop: 16, display: 'inline-block' }}>Explore Passport</Link>
    </>,
  );
}
