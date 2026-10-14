import { useEffect, useRef, type RefObject } from "react";
import { createChannel, needleSpring, type SpringConfig } from "./spring";

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Writes animation frames straight to the element, bypassing React renders.
export function useSpring<T extends Element>(
  target: number,
  apply: (el: T, value: number) => void,
  config: SpringConfig = needleSpring,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const channel = useRef<ReturnType<typeof createChannel> | null>(null);
  const value = useRef(target);
  useEffect(() => {
    const ch = createChannel(value.current, (v) => {
      value.current = v;
      if (ref.current) applyRef.current(ref.current, v);
    }, config);
    channel.current = ch;
    return () => {
      ch.dispose();
      channel.current = null;
    };
  }, [config]);
  useEffect(() => {
    channel.current?.set(target, prefersReducedMotion());
  }, [target, config]);
  return ref;
}
