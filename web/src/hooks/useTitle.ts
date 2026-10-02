import { useEffect } from "react";

export function useTitle(title: string) {
  useEffect(() => { document.title = title ? `${title} · Haagse Lens` : "Haagse Lens · politiek in het nieuws"; }, [title]);
}
