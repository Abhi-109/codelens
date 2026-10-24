import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function current() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

/** The user's reduced-motion preference, kept live as the OS setting changes. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(current);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(QUERY);
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}
