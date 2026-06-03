import { useEffect } from 'react';

const LOGIN_URL = 'https://login.lakeandlocals.com/login';

export default function LoginPage() {
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const returnToParam = searchParams.get('return_to') || '/';
    
    // Construct the absolute return URL back to this passport SPA instance
    const returnUrl = window.location.origin + (returnToParam.startsWith('/') ? returnToParam : '/' + returnToParam);

    const url = new URL(LOGIN_URL);
    url.searchParams.set('return_to', returnUrl);
    window.location.replace(url.toString());
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <p style={{ color: '#6b7c6b', fontSize: '15px' }}>Redirecting to sign in…</p>
    </div>
  );
}
