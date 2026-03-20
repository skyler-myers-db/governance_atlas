import { useEffect, useState } from "react";
import { fetchBootstrap } from "../lib/api";

export function useBootstrap() {
  const [state, setState] = useState({
    loading: true,
    error: "",
    data: null,
  });

  useEffect(() => {
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
  }, []);

  return state;
}
