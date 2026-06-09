import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { getMe } from '../../api/auth';
import { updateProfile, uploadAvatar } from '../../api/profile';
import { ProfilePanel as SharedProfilePanel } from 'kk-shared-ui';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export default function ProfilePanel({ open, onClose, onSaved }: Props) {
  const { user, updateUser } = useAuth();
  const { tenant } = useTenant();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    display_name: '', location: '', bio: '',
  });
  const [saveError, setSaveError]     = useState('');
  const [saved, setSaved]             = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [isFetching, setIsFetching]   = useState(false);

  useEffect(() => {
    if (!open || !user || !tenant) return;
    setSaveError('');
    setSaved(false);
    setAvatarError('');
    setIsFetching(true);
    getMe(tenant.id)
      .then(fresh => {
        updateUser(fresh);
        setForm({
          display_name: fresh.display_name || '',
          location:     fresh.location     || '',
          bio:          (fresh as any).bio || '',
        });
      })
      .catch(() => {
        setForm({
          display_name: user.display_name || '',
          location:     user.location     || '',
          bio:          (user as any).bio || '',
        });
      })
      .finally(() => setIsFetching(false));
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: (updates: Parameters<typeof updateProfile>[1]) =>
      updateProfile(tenant!.id, updates),
  });

  const avatarMutation = useMutation({
    mutationFn: ({ tenantId, blob }: { tenantId: string; blob: Blob }) =>
      uploadAvatar(tenantId, blob),
    onSuccess: (res) => {
      const url = res.data.avatar_url;
      if (url) {
        updateUser({ avatar_url: url });
        qc.invalidateQueries({ queryKey: ['me'] });
      }
      setAvatarError('');
    },
    onError: (e: any) => setAvatarError(e.message || 'Photo upload failed.'),
  });

  const handleAvatarUpload = useCallback(async (blob: Blob) => {
    if (!tenant) return;
    avatarMutation.mutate({ tenantId: tenant.id, blob });
  }, [tenant, avatarMutation]);

  const handleSave = useCallback(async (updates: {
    display_name: string;
    location: string;
    bio: string;
  }) => {
    setSaveError('');
    try {
      const profileRes = await saveMutation.mutateAsync({
        display_name: updates.display_name.trim() || undefined,
        location:     updates.location.trim()     || undefined,
        bio:          updates.bio.trim()          || undefined,
      });
      updateUser(profileRes.data.user);

      qc.invalidateQueries({ queryKey: ['me'] });
      setSaved(true);
      setTimeout(() => {
        onSaved?.();
      }, 800);
    } catch (e: any) {
      setSaveError(e.message || 'Could not save changes.');
    }
  }, [saveMutation, updateUser, qc, onSaved]);

  const handleAccountDetailsClick = useCallback(() => {
    navigate('/profile');
  }, [navigate]);

  const isPending = saveMutation.isPending || isFetching;

  // Adapt the user profile object for the shared ProfilePanel.
  const adaptedUser = user ? {
    display_name: form.display_name || user.display_name,
    email: user.email,
    avatar_url: user.avatar_url,
    location: form.location || user.location,
    bio: form.bio || (user as any).bio,
  } : null;

  return (
    <SharedProfilePanel
      open={open}
      onClose={onClose}
      user={adaptedUser}
      isSaving={isPending}
      isUploading={avatarMutation.isPending}
      saved={saved}
      saveError={saveError}
      avatarError={avatarError}
      onSave={handleSave}
      onUploadAvatar={handleAvatarUpload}
      onAccountDetailsClick={handleAccountDetailsClick}
      showZipFields={false}
    />
  );
}
