import { useEffect } from "react";

export function useTitle(title: string) {
  useEffect(() => { document.title = title ? `${title} · Hofvijver` : "Hofvijver · politiek in het nieuws"; }, [title]);
}
