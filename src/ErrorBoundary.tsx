import { Component } from "react";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes anywhere below it and shows a recovery screen
 * instead of a blank page. Placed outside the data provider so a failure in
 * session or workspace loading is caught too.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("Complyrer crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-fallback" role="alert">
          <h1>Something went wrong</h1>
          <p>
            Complyrer ran into a problem loading this view. Your records are
            safe — reloading usually clears it.
          </p>
          <button
            className="button primary"
            onClick={() => window.location.reload()}
          >
            Reload Complyrer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
