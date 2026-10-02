import { useEffect, useState } from "react";
import { loadMonitor, type Base } from "../services/monitor";

type State = { status: "loading" } | { status: "ready"; data: Base } | { status: "error"; error: Error };

export function useMonitor(): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    loadMonitor().then(
      (data) => alive && setState({ status: "ready", data }),
      (error: Error) => alive && setState({ status: "error", error }),
    );
    return () => { alive = false; };
  }, []);
  return state;
}
