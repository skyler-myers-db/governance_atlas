import { Component } from "react";
import { WorkspaceStateCard } from "./ShellStatePrimitives";

function formatErrorMessage(error) {
  if (!error) return "Unknown frontend error.";
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
  return error.name || "Unknown frontend error.";
}

/** Detect the "stale chunk after redeploy" failure.
 *
 * When we ship a new bundle, the old index.js held by an open tab keeps its
 * pre-built references to chunk file names whose hashes no longer exist on
 * the CDN. The next lazy `import()` resolves to a 404, which React surfaces
 * as either "Failed to fetch dynamically imported module" (Chromium/Safari)
 * or a ChunkLoadError (Webpack-era terminology, but some bundles still
 * throw it). Both mean the same thing: the user's tab is simply out of
 * date. We render a gentle "Reload to load the latest workspace" card with
 * a one-click reload button instead of the generic "unexpected rendering
 * failure" page.
 */
function isStaleChunkError(error) {
  if (!error) return false;
  const message = typeof error === "string" ? error : error.message || "";
  const name = (error && error.name) || "";
  if (name === "ChunkLoadError") return true;
  return /Failed to fetch dynamically imported module/i.test(message)
    || /Importing a module script failed/i.test(message)
    || /error loading dynamically imported module/i.test(message);
}

function isResizeObserverLoopError(error, message = "") {
  const errorMessage = typeof error === "string" ? error : error?.message || "";
  const candidate = `${message || ""} ${errorMessage || ""}`.trim();
  return /ResizeObserver loop completed with undelivered notifications/i.test(candidate)
    || /ResizeObserver loop limit exceeded/i.test(candidate);
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
    console.error("Governance Atlas render failure", error, info);
  }

  componentDidMount() {
    this.handleWindowError = (event) => {
      if (isResizeObserverLoopError(event?.error, event?.message)) {
        event?.preventDefault?.();
        return;
      }
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

    // Stale-chunk failure after a redeploy. This is not a bug — the user's
    // browser is just holding an old index.js that references chunk names
    // the CDN no longer serves. Render a one-click-reload card instead of
    // the generic "rendering failure" message so users don't think the
    // app itself broke.
    if (isStaleChunkError(activeError)) {
      return (
        <section className="gh-workspace gh-unavailable-workspace">
          <WorkspaceStateCard
            eyebrow="New version available"
            message="Governance Atlas has been redeployed since you opened this tab. Reload to load the newest workspace bundle."
            title="Reload to pick up the latest build"
            tone="neutral"
          >
            <div className="gh-support-copy">
              Your session will be preserved — the reload only refreshes the
              client-side bundle.
            </div>
            <div style={{ marginTop: 12 }}>
              <button
                className="gh-primary-button"
                onClick={() => {
                  try {
                    window.location.reload();
                  } catch (_) {
                    /* ignore */
                  }
                }}
                type="button"
              >
                Reload now
              </button>
            </div>
          </WorkspaceStateCard>
        </section>
      );
    }

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
