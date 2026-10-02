import { useEffect } from "react";

export function useTitle(title: string) {
  useEffect(() => { document.title = title ? `${title} · Politiek Monitor` : "Politiek Monitor"; }, [title]);
}
