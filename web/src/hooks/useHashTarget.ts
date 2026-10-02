import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** Scrolls to the element named in the location hash (e.g. /politiek#motie) once it is rendered. */
export function useHashTarget(ready = true) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.focus?.({ preventScroll: true });
  }, [hash, ready]);
  return hash ? decodeURIComponent(hash.slice(1)) : "";
}
