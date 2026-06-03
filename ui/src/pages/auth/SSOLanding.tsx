import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ssoLogin } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';
import { Spinner } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';

export default function SSOLanding() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params: Record<string, string> = {};
    searchParams.forEach((value, key) => { params[key] = value; });

    const { uid, ts, email, sig } = params;
    if (!uid || !ts || !email || !sig) {
      setError('Invalid SSO link. Required parameters are missing.');
      return;
    }

    ssoLogin(params)
      .then(result => {
        login(result);
        navigate('/skills', { replace: true });
      })
      .catch(err => {
        setError(err.message || 'SSO authentication failed. Please try again or log in manually.');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div style={{ maxWidth: 480, margin: '40px auto' }}>
        <Alert type="error">{error}</Alert>
        <a href="/auth/login" className="btn btn-primary btn-block">Log in manually</a>
      </div>
    );
  }

  return (
    <div className="spinner-center" style={{ minHeight: '60vh', flexDirection: 'column', gap: 16 }}>
      <Spinner size="lg" />
      <p style={{ fontFamily: 'var(--font-sans)', color: 'var(--muted)', fontSize: '0.9rem' }}>
        Signing you in&hellip;
      </p>
    </div>
  );
}
