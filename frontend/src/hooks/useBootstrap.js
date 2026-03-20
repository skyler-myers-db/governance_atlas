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
    error: "",
    data: seeded,
  });

  useEffect(() => {
    if (seeded) return undefined;

    let canceled = false;
    fetchBootstrap()
      .then((data) => {
        if (canceled) return;
        setState({ loading: false, error: "", data });
      })
      .catch((error) => {
        if (canceled) return;
        setState({
          loading: false,
          error: error?.message || "Failed to load Governance Hub bootstrap payload.",
          data: null,
        });
      });
    return () => {
      canceled = true;
    };
  }, [seeded]);

  return state;
}
