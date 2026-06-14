import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '../../context/TenantContext';
import { useAuth } from '../../context/AuthContext';
import { getMember } from '../../api/profile';
import { Spinner } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import BadgeStrip from '../../components/ui/BadgeStrip';
import RatingsDrawer from '../../components/profile/RatingsDrawer';

function Avatar({ name, size = 64 }: { name: string; size?: number }) {
  const parts = name.trim().split(' ');
  const letters = parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : name.slice(0, 2);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--green)', color: 'var(--cream)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.35, fontWeight: 'bold', flexShrink: 0,
    }}>
      {letters.toUpperCase()}
    </div>
  );
}

export default function PublicProfile() {
  const { id } = useParams<{ id: string }>();
  const { tenant } = useTenant();
  const { user: currentUser } = useAuth();
  const [ratingsOpen, setRatingsOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['member', tenant?.id, id],
    queryFn: () => getMember(tenant!.id, id!),
    enabled: !!tenant && !!id,
  });

  if (isLoading) {
    return (
      <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="main-content" style={{ paddingTop: 32 }}>
        <Alert type="error">Member not found.</Alert>
      </div>
    );
  }

  const { member, badges = [] } = data.data as any;

  return (
    <div className="main-content" style={{ paddingTop: 24, paddingBottom: 80 }}>

      {/* Identity */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 12 }}>
          <Avatar name={member.display_name} />
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '1.15rem' }}>{member.display_name}</h2>
            {member.location && (
              <p style={{ margin: '0 0 6px', fontSize: '0.85rem', color: 'var(--sage)' }}>
                {member.location}
              </p>
            )}
          </div>
        </div>

        {badges.length > 0 && (
          <BadgeStrip badges={badges} style={{ marginTop: 12 }} />
        )}

        {member.bio && (
          <p style={{
            margin: '12px 0 0', fontSize: '0.9rem',
            borderLeft: '3px solid var(--border)', paddingLeft: 12,
          }}>
            {member.bio}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setRatingsOpen(true)}
          >
            {(member.rating_count ?? 0) > 0
              ? `★ ${(member.rating_avg ?? 0).toFixed(1)} · ${member.rating_count} review${member.rating_count !== 1 ? 's' : ''}`
              : 'Reviews'}
          </button>
        </div>
      </div>

      <RatingsDrawer
        open={ratingsOpen}
        view="reviews"
        onClose={() => setRatingsOpen(false)}
        memberId={id!}
        memberName={member.display_name}
        tenantId={tenant?.id ?? ''}
        currentUserId={currentUser?.id}
        isOwnProfile={currentUser?.id === String(member.id)}
      />

    </div>
  );
}
