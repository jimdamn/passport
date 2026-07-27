import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack: string }) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
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
