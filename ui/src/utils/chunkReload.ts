// Shared between main.tsx's vite:preloadError listener and ErrorBoundary's
// dynamic-import-failure catch - both can independently observe the same
// underlying failure (a lazy chunk 404 after a deploy), and must share one
// reload budget so a genuinely broken chunk gets exactly one automatic
// retry total, not one from each detection path.
export const CHUNK_RELOAD_GUARD_KEY = 'kk_chunk_reload_attempted';

export function reloadOnceForChunkFailure(): void {
  if (sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) === '1') return;
  sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, '1');
  window.location.reload();
}
