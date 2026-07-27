import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { setToken } from '../api/client';
import { refreshToken, logout as apiLogout } from '../api/auth';
import type { AuthResult } from '../api/auth';
import type { User } from '../types';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (result: AuthResult) => void;
  logout: () => void;
  updateUser: (partial: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const REVOKE_PENDING_KEY = 'kk_revoke_pending';
const REVOKE_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('revoke timed out')), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

// Revoke the refresh cookie in the background. On failure (timeout, offline,
// server error) the httpOnly cookie survives, so a pending flag is persisted
// and retried on the next boot - before refreshToken() runs - so a stale
// cookie can never sign the next person on this device back in as this one.
async function revokeSession() {
  try {
    await withTimeout(apiLogout(), REVOKE_TIMEOUT_MS);
    localStorage.removeItem(REVOKE_PENDING_KEY);
  } catch {
    localStorage.setItem(REVOKE_PENDING_KEY, '1');
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        if (localStorage.getItem(REVOKE_PENDING_KEY)) {
          // A previous sign-out's revoke never confirmed - settle it before
          // asking the server for a session, so a surviving stale cookie
          // can't hand this boot someone else's identity.
          await revokeSession();
        }
        // refreshToken returns a slim KKAuth user (id, email, name, bd_member).
        // Full Exchange user data (credits_balance, trade_count, etc.) is loaded
        // at the page level once tenant context is available.
        const result = await refreshToken();
        if (!result) return; // no session - stay logged out
        setToken(result.access_token);
        setTokenState(result.access_token);
        // Cast to User - Exchange-specific fields will be undefined until /me is called
        setUser(result.user as unknown as User);
      } catch {
        // Stay logged out - no action needed
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback((result: AuthResult) => {
    setToken(result.access_token);
    setTokenState(result.access_token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    // Clear client state immediately so UI responds at once
    setToken(null);
    setTokenState(null);
    setUser(null);
    // Fire the backend call to revoke the refresh cookie - don't await, so the
    // UI doesn't block. revokeSession() itself times out and persists a retry
    // flag on failure rather than silently swallowing it.
    revokeSession();
  }, []);

  const updateUser = useCallback((partial: Partial<User>) => {
    setUser(prev => {
      if (!prev) return null;
      // Deep/shallow comparison to avoid setting new reference if values are identical
      const hasChanges = Object.keys(partial).some(
        key => prev[key as keyof User] !== partial[key as keyof User]
      );
      if (!hasChanges) return prev;
      return { ...prev, ...partial };
    });
  }, []);

  const contextValue = useMemo(() => ({
    user,
    token,
    isLoading,
    login,
    logout,
    updateUser,
  }), [user, token, isLoading, login, logout, updateUser]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

