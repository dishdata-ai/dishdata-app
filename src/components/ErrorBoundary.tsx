import { Component, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="glass max-w-md rounded-2xl p-8 text-center">
          <p className="font-display text-xl font-bold text-white">Something went wrong</p>
          <p className="mt-2 text-sm text-zinc-400">
            {this.state.error.message || "An unexpected error occurred in this view."}
          </p>
          <button
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
            className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-accent-400 px-4 py-2 text-sm font-semibold text-zinc-950"
          >
            <RotateCcw className="h-4 w-4" /> Reload
          </button>
        </div>
      </div>
    );
  }
}
