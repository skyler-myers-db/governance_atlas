import { useEffect, useMemo, useState } from "react";
import { fetchBootstrap } from "../lib/api";

function initialBootstrap() {
  if (typeof window === "undefined") return null;
  return window.__GOVHUB_BOOTSTRAP__ || null;
}

export function useBootstrap() {
  const seeded = useMemo(() => initialBootstrap(), []);
  const [state, setState] = useState({
    loading: !seeded,
    refreshing: Boolean(seeded),
    error: "",
    refreshError: "",
    data: seeded,
  });

  useEffect(() => {
    let canceled = false;
    setState((current) => ({
      loading: !current.data,
      refreshing: true,
      error: current.data ? "" : current.error,
      refreshError: "",
      data: current.data,
    }));
    fetchBootstrap()
      .then((data) => {
        if (canceled) return;
        setState({ loading: false, refreshing: false, error: "", refreshError: "", data });
      })
      .catch((error) => {
        if (canceled) return;
        const message = error?.message || "Failed to load Governance Hub bootstrap payload.";
        setState((current) =>
          current.data
            ? {
                loading: false,
                refreshing: false,
                error: "",
                refreshError: message,
                data: current.data,
              }
            : {
                loading: false,
                refreshing: false,
                error: message,
                refreshError: "",
                data: null,
              },
        );
      });
    return () => {
      canceled = true;
    };
  }, [seeded]);

  return state;
}
