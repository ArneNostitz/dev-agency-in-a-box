// Preact hooks — viewport/desktop breakpoint helpers.
// Imports useState/useEffect from standalone (the app's Preact + htm shim).

import { useState, useEffect } from "/web/vendor/standalone.mjs";

// Reactive desktop/mobile breakpoint (matches the CSS @media min-width:880px). Computing this
// inline during render is unreliable — matchMedia can report the wrong value on first paint and
// then flip on a later re-render, which made the board's extra columns vanish after a few seconds.
// Live viewport width (debounced via rAF) — lets the layout resolver pick narrow/medium/wide tiers.
export function useViewportWidth() {
  const [w, setW] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1200));
  useEffect(() => {
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setW(window.innerWidth)); };
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, []);
  return w;
}

export function useIsDesktop() {
  const mq = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width:880px)") : null);
  const [d, setD] = useState(() => { const m = mq(); return m ? m.matches : false; });
  useEffect(() => {
    const m = mq(); if (!m) return; const fn = () => setD(m.matches); fn();
    if (m.addEventListener) m.addEventListener("change", fn); else m.addListener(fn);
    return () => { if (m.removeEventListener) m.removeEventListener("change", fn); else m.removeListener(fn); };
  }, []);
  return d;
}
