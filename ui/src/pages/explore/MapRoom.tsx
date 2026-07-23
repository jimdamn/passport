import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { RegionMap } from 'kk-shared-ui';
import { ArrowLeft } from 'lucide-react';
import LensRow from '../../components/explore/LensRow';
import {
  useLens, getAroundInterests, fetchAroundBoardData, pinsForLens,
  REGION_CENTER, REGION_BOUNDS,
  type AroundBoardData,
} from '../../api/around';

// The map room - the full-screen, fully interactive twin of the board's
// static postcard. Same lens chips (floating), same pin builders, RegionMap's
// own popups (no custom bottom sheet - plan §10 is explicit that the popup is
// the v1 contract). Route: /explore/map.
//
// Positioned as a viewport-fixed overlay (rather than fighting AppLayout's
// .main-content padding with negative margins) so the map genuinely fills the
// space between the topbar and the bottom nav regardless of that padding -
// see index.css .topbar/.bottom-nav for the two heights baked in below.
export default function MapRoom() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [picks, setPicks] = useState<string[]>([]);
  useEffect(() => {
    if (!user || !tenant) return;
    getAroundInterests(tenant.id).then(res => setPicks(res.data.interests)).catch(() => {});
  }, [user, tenant]);

  const { activeLens, order, setLens } = useLens(picks);

  const [boardData, setBoardData] = useState<AroundBoardData | null>(null);
  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    fetchAroundBoardData(tenant.id).then(data => { if (!cancelled) setBoardData(data); });
    return () => { cancelled = true; };
  }, [tenant]);

  const memberHome = user?.home_zip_lat != null && user?.home_zip_lon != null
    ? { lat: user.home_zip_lat, lon: user.home_zip_lon }
    : null;

  const pins = boardData ? pinsForLens(activeLens, boardData) : [];

  return (
    <div style={{
      position: 'fixed',
      top: 'calc(52px + env(safe-area-inset-top))', // .topbar height, index.css
      bottom: 60, // .bottom-nav height, index.css (hidden on desktop - acceptable, this is a mobile-first surface)
      left: 0,
      right: 0,
      zIndex: 1,
    }}>
      <RegionMap
        pins={pins}
        center={memberHome ?? REGION_CENTER}
        zoom={memberHome ? 10 : 9}
        maxBounds={REGION_BOUNDS}
        height="100%"
      />

      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 2 }}>
        <div style={{
          background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(6px)',
          borderRadius: 'var(--r-lg)', padding: '8px 8px 4px',
        }}>
          <LensRow order={order} activeLens={activeLens} onSelect={setLens} />
        </div>
        <button
          onClick={() => navigate('/explore')}
          style={{
            marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(255,255,255,0.92)', border: 'none', borderRadius: 'var(--r-pill)',
            padding: '8px 14px', color: 'var(--green)', fontWeight: 600, fontSize: '0.85rem',
            minHeight: 44, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
          }}
        >
          <ArrowLeft size={14} /> Back to the board
        </button>
      </div>

      {activeLens === 'hands' && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
          background: 'rgba(255,255,255,0.95)', borderRadius: 'var(--r-md)', padding: '10px 16px',
          maxWidth: '90%', textAlign: 'center', fontSize: '0.82rem', color: 'var(--green)',
          boxShadow: '0 1px 6px rgba(0,0,0,0.15)',
        }}>
          Volunteer shifts list their address on each listing - no map pins yet.
        </div>
      )}
    </div>
  );
}
