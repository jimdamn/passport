import { Link, useLocation } from 'react-router-dom';
import { Map, Award, User, LayoutGrid, Tag } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function BottomNav() {
  const location = useLocation();
  const { user } = useAuth();

  function isActive(path: string) {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  }

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      <Link
        to="/explore"
        className={`bottom-nav-tab ${location.pathname === '/explore' ? 'active' : ''}`}
        aria-label="Explore partners"
      >
        <Map size={20} />
        <span>Explore</span>
      </Link>

      <Link
        to="/deals"
        className={`bottom-nav-tab ${isActive('/deals') ? 'active' : ''}`}
        aria-label="Deals"
      >
        <Tag size={20} />
        <span>Deals</span>
      </Link>

      <Link
        to="/my-stamps"
        className={`bottom-nav-tab ${isActive('/my-stamps') ? 'active' : ''}`}
        aria-label="My stamps"
      >
        <Award size={20} />
        <span>Stamps</span>
      </Link>

      <Link
        to={user ? '/profile' : '/auth/login'}
        className={`bottom-nav-tab ${isActive('/profile') ? 'active' : ''}`}
        aria-label="My profile"
      >
        <User size={20} />
        <span>Me</span>
      </Link>

      <a
        href="https://apps.lakeandlocals.com"
        className="bottom-nav-tab"
        aria-label="Apps Hub"
      >
        <LayoutGrid size={20} />
        <span>Hub</span>
      </a>
    </nav>
  );
}
