import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { TenantProvider } from './context/TenantContext';
import { reloadOnceForChunkFailure } from './utils/chunkReload';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// A lazy route's chunk can 404 after a deploy (the hash it was built with no
// longer exists). Vite's dynamic import wrapper detects that and fires this
// event instead of leaving the import promise to reject uncaught - reload to
// pick up the current build rather than leaving a half-loaded route. Guarded
// (see chunkReload.ts) so a genuinely broken chunk gets one retry, not a
// reload loop.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  reloadOnceForChunkFailure();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TenantProvider>
            <App />
          </TenantProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
