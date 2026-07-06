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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
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
    // Fire the backend call to revoke the refresh cookie - don't await,
    // so the UI doesn't block. Even if this fails the cookie will eventually expire.
    apiLogout().catch(() => {});
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

