import { Component, type ReactNode } from 'react';
import { CHUNK_RELOAD_GUARD_KEY, reloadOnceForChunkFailure } from '../utils/chunkReload';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  // A lazy chunk 404 (stale client, new deploy) throws this specific error
  // shape. It gets one automatic reload instead of the generic error card -
  // guarded (chunkReload.ts) so a genuinely broken chunk can't loop forever.
  isChunkError: boolean;
}

const CHUNK_ERROR_PATTERN = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkError: false };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    const isChunkError = CHUNK_ERROR_PATTERN.test(message)
      && sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) !== '1';
    return { hasError: true, isChunkError };
  }

  componentDidCatch(error: unknown, info: { componentStack: string }) {
    console.error('Unhandled render error:', error, info.componentStack);
    if (this.state.isChunkError) {
      reloadOnceForChunkFailure();
    }
  }

  componentDidMount() {
    // Stayed up without immediately re-throwing - clear the guard so a
    // genuinely new stale-chunk incident later in this tab's life still
    // gets its own single automatic retry.
    setTimeout(() => sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY), 5000);
  }

  render() {
    if (this.state.hasError) {
      if (this.state.isChunkError) {
        return (
          <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-sans)', color: 'var(--muted)' }}>
              This page was updated. Reloading...
            </p>
          </div>
        );
      }

      return (
        <div className="main-content" style={{ paddingTop: 48 }}>
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <p style={{
              margin: '0 0 8px', fontFamily: 'var(--font-serif)', fontWeight: 'bold',
              fontSize: '1.15rem', color: 'var(--green)',
            }}>
              Something went wrong.
            </p>
            <p style={{ margin: '0 0 20px', fontSize: '0.9rem', color: 'var(--muted)' }}>
              Reload the page and it should come back. If it keeps happening, use Talk to Us from your profile.
            </p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
