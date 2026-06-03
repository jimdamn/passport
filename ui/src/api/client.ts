let _token: string | null = null;

export function setToken(t: string | null) { _token = t; }
export function getToken() { return _token; }

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> || {}),
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'include' });

  if (res.status === 401 && path !== '/auth/refresh') {
    // Try silent refresh
    try {
      const refreshRes = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (refreshRes.ok) {
        const { data } = await refreshRes.json();
        setToken(data.access_token);
        headers['Authorization'] = `Bearer ${data.access_token}`;
        const retry = await fetch(`/api${path}`, { ...init, headers, credentials: 'include' });
        if (!retry.ok) throw new Error(await retry.text());
        return retry.json();
      }
    } catch {}
    setToken(null);
    throw new Error('Please log in.');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};
