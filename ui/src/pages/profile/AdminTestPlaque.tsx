import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { createTestPlaque, removeTestPlaque, type TestPlaqueResult } from '../../api/admin';
import { ArrowLeft, MapPin, Trash2, ExternalLink, Copy } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';

export default function AdminTestPlaque() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [result, setResult] = useState<TestPlaqueResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/auth/login');
      return;
    }
    if (!user.is_admin) {
      navigate('/profile');
    }
  }, [user]);

  const handleCreate = () => {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    setNotice('');

    if (!navigator.geolocation) {
      setError('This browser does not support location access.');
      setWorking(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await createTestPlaque(tenant.id, pos.coords.latitude, pos.coords.longitude);
          setResult(res.data);
          setNotice('Test plaque created at your current location. Scan cooldowns were reset, so you can scan it right away.');
        } catch (err: any) {
          setError(err.message || 'Failed to create the test plaque.');
        } finally {
          setWorking(false);
        }
      },
      (geoErr) => {
        setError(
          geoErr.code === geoErr.PERMISSION_DENIED
            ? 'Location permission was denied. The test plaque must be placed at your current location — please allow location access and try again.'
            : 'Could not determine your location. Please try again.'
        );
        setWorking(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleRemove = async () => {
    if (!tenant || working) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await removeTestPlaque(tenant.id);
      setResult(null);
      setNotice('Test plaque and all of its test scans, claims, and prize were removed.');
    } catch (err: any) {
      setError(err.message || 'Failed to remove the test plaque.');
    } finally {
      setWorking(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.scan_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — the link is still visible to copy by hand
    }
  };

  return (
    <div className="main-content" style={{ maxWidth: 560, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
        Test Plaque
      </h1>
      <p style={{ margin: '0 0 20px', fontSize: '0.82rem', color: 'var(--muted)' }}>
        Creates one test plaque at your current location so you can verify the full scan flow:
        QR signature, location check, prize draw, and stamps. Creating it again moves it to
        wherever you are standing and resets its scan cooldown.
      </p>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      {notice && <Alert type="success" style={{ marginBottom: 16 }}>{notice}</Alert>}

      <div className="card" style={{ padding: 20, background: 'var(--white)', marginBottom: 16 }}>
        <button
          className="btn btn-amber"
          onClick={handleCreate}
          disabled={working}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <MapPin size={16} />
          {working ? 'Working...' : result ? 'Move Test Plaque to My Location' : 'Create Test Plaque at My Location'}
        </button>
      </div>

      {result && (
        <div className="card" style={{ padding: 24, background: 'var(--white)', textAlign: 'center' }}>
          <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--muted)' }}>
            Scan this QR code with another phone — or open the link below on this one.
          </p>

          <div
            style={{ width: 220, height: 220, margin: '0 auto 16px', padding: 12, background: '#fff', border: '1px solid var(--border, #ddd8cc)', borderRadius: 8 }}
            dangerouslySetInnerHTML={{ __html: result.qr_svg }}
          />

          <p style={{ margin: '0 0 16px', fontSize: '0.72rem', color: 'var(--muted)', wordBreak: 'break-all' }}>
            {result.scan_url}
          </p>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a
              href={result.scan_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
            >
              <ExternalLink size={14} /> Open Scan Link
            </a>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleCopy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Copy size={14} /> {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 20, background: 'var(--white)', marginTop: 16 }}>
        <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--muted)' }}>
          When you are done testing, remove the plaque so it never shows up for real visitors.
          This also deletes its test scans, claims, and prize.
        </p>
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleRemove}
          disabled={working}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderColor: 'var(--error)', color: 'var(--error)' }}
        >
          <Trash2 size={14} /> Remove Test Plaque
        </button>
      </div>
    </div>
  );
}
