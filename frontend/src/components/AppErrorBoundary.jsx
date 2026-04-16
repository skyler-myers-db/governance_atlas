import { Component } from "react";
import { WorkspaceStateCard } from "./ShellStatePrimitives";

function formatErrorMessage(error) {
  if (!error) return "Unknown frontend error.";
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
  return error.name || "Unknown frontend error.";
}

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      error: null,
      eventError: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Governance Hub render failure", error, info);
  }

  componentDidMount() {
    this.handleWindowError = (event) => {
      this.setState({ eventError: event?.error || new Error(event?.message || "Unhandled window error.") });
    };
    this.handleUnhandledRejection = (event) => {
      const reason = event?.reason;
      const error =
        reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : "Unhandled promise rejection.");
      this.setState({ eventError: error });
    };
    window.addEventListener("error", this.handleWindowError);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.handleWindowError);
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
  }

  render() {
    const activeError = this.state.error || this.state.eventError;
    if (!activeError) return this.props.children;
    return (
      <section className="gh-workspace gh-unavailable-workspace">
        <WorkspaceStateCard
          eyebrow="Frontend Error"
          message={formatErrorMessage(activeError)}
          title="The workspace hit an unexpected rendering failure."
          tone="bad"
        >
          <div className="gh-support-copy">
            The page stayed reachable, but a client-side error interrupted rendering. Reload after the fix deploys.
          </div>
        </WorkspaceStateCard>
      </section>
    );
  }
}
