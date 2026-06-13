import { useState, useEffect } from 'react';
import { getPersonalPersona, updatePersonalPersona, updatePersona } from '../../api/profile';
import { Alert } from '../ui/Alert';

interface Props {
  open: boolean;
  currentPersona: 'anonymous' | 'personal' | 'business';
  tenantId: string;
  displayName: string | null;
  onClose: () => void;
  onSwitch: () => void;
}

export function PersonalPersonaDrawer({
  open,
  currentPersona,
  tenantId,
  displayName,
  onClose,
  onSwitch,
}: Props) {
  const [formState, setFormState] = useState({
    facebook_url: '',
    x_handle: '',
    linkedin_url: '',
    website_url: '',
  });
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setErrorMsg(null);
      setSuccessMsg(null);
      setLoading(true);
      getPersonalPersona(tenantId)
        .then((res) => {
          const d = res.data || {};
          setFormState({
            facebook_url: d.facebook_url || '',
            x_handle: d.x_handle || '',
            linkedin_url: d.linkedin_url || '',
            website_url: d.website_url || '',
          });
        })
        .catch((err) => {
          setErrorMsg(err?.message || 'Failed to load personal persona settings.');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, tenantId]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleXChange = (val: string) => {
    setFormState(prev => ({ ...prev, x_handle: val.startsWith('@') ? val.slice(1) : val }));
  };

  const validateUrl = (url: string, name: string) => {
    if (url && !url.startsWith('https://')) {
      throw new Error(`${name} must start with https://`);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      validateUrl(formState.facebook_url, 'Facebook URL');
      validateUrl(formState.linkedin_url, 'LinkedIn URL');
      validateUrl(formState.website_url, 'Website URL');

      const data = {
        facebook_url: formState.facebook_url.trim() || null,
        x_handle: formState.x_handle.trim() || null,
        linkedin_url: formState.linkedin_url.trim() || null,
        website_url: formState.website_url.trim() || null,
      };

      await updatePersonalPersona(tenantId, data);
      setSuccessMsg('Personal settings saved successfully.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save settings.');
    } finally {
      setLoading(false);
    }
  };

  const handleSwitch = async () => {
    setSwitching(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await updatePersona('personal');
      onSwitch();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to switch persona.');
    } finally {
      setSwitching(false);
    }
  };

  const isPending = loading || switching;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 200,
          display: open ? 'block' : 'none',
        }}
      />

      <aside
        aria-label="Personal Persona Settings"
        aria-hidden={!open}
        {...(!open ? { inert: '' } : {})}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(400px, 100vw)',
          background: 'var(--cream)',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          paddingRight: 'max(16px, env(safe-area-inset-right))',
          paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
          paddingLeft: '16px',
          overflowY: 'auto',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--green)',
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--r-sm)',
              flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.15rem', fontWeight: 'bold', color: 'var(--green)', margin: 0 }}>
            🙋 Personal Persona
          </h2>
        </div>

        <div style={{
          background: 'var(--white)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          padding: '14px 16px',
          marginBottom: 20,
        }}>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.84rem', color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
            When posting as Personal, your display name is visible to other members. You can optionally share social profile links — these are shown on your public profile.
          </p>
        </div>

        {errorMsg && <Alert type="error" style={{ marginBottom: 16 }}>{errorMsg}</Alert>}
        {successMsg && <Alert type="success" style={{ marginBottom: 16 }}>{successMsg}</Alert>}

        {currentPersona !== 'personal' && (
          <button
            type="button"
            className="btn btn-amber btn-block"
            style={{ marginBottom: 20 }}
            disabled={isPending}
            onClick={handleSwitch}
          >
            {switching ? 'Switching...' : 'Set as Active Persona'}
          </button>
        )}

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label className="form-label">Display Name</label>
            <input
              className="form-input"
              type="text"
              value={displayName || ''}
              readOnly
              style={{ background: '#f5f5f5', color: '#888', cursor: 'not-allowed' }}
            />
            <p className="form-hint">To update your display name, use Edit Profile.</p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="personaFacebook">Facebook URL</label>
            <input
              className="form-input"
              type="url"
              id="personaFacebook"
              maxLength={255}
              placeholder="https://facebook.com/username"
              value={formState.facebook_url}
              onChange={(e) => setFormState(prev => ({ ...prev, facebook_url: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="personaTwitter">X (Twitter) Handle</label>
            <input
              className="form-input"
              type="text"
              id="personaTwitter"
              maxLength={50}
              placeholder="username"
              value={formState.x_handle}
              onChange={(e) => handleXChange(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="personaLinkedIn">LinkedIn URL</label>
            <input
              className="form-input"
              type="url"
              id="personaLinkedIn"
              maxLength={255}
              placeholder="https://linkedin.com/in/username"
              value={formState.linkedin_url}
              onChange={(e) => setFormState(prev => ({ ...prev, linkedin_url: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="personaWebsite">Website URL</label>
            <input
              className="form-input"
              type="url"
              id="personaWebsite"
              maxLength={255}
              placeholder="https://example.com"
              value={formState.website_url}
              onChange={(e) => setFormState(prev => ({ ...prev, website_url: e.target.value }))}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={isPending}
          >
            {loading ? 'Saving...' : 'Save Settings'}
          </button>
        </form>
      </aside>
    </>
  );
}
