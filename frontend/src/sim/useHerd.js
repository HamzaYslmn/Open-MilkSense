import { useEffect, useRef, useState } from "react";
import { Herd } from "./herd.js";

// Drives the in-browser simulation: one Herd, advanced ~once a second of wall time, with the
// fresh snapshot pushed into React state so the whole UI re-renders live.
export function useHerd() {
  const ref = useRef(null);
  if (!ref.current) ref.current = new Herd();
  const [snap, setSnap] = useState(() => ref.current.snapshot());
  useEffect(() => {
    let last = performance.now();
    const iv = setInterval(() => {
      const now = performance.now();
      ref.current.tick((now - last) / 1000);
      last = now;
      setSnap(ref.current.snapshot());
    }, 1000);
    return () => clearInterval(iv);
  }, []);
  return {
    snap,
    buzz: (id, on) => ref.current.buzz(id, on),
    detail: (id) => ref.current.detail(id),
  };
}
