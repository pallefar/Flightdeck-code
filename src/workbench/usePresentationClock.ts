import { useEffect, useState, type RefObject } from "react";

/** Presentation clocks follow the real document and retained parent surface.
 * This never grants voice consent or changes candidate/source state. */
export function usePresentationClock(root: RefObject<HTMLElement | null>, active: boolean) {
  const [environment, setEnvironment] = useState(() => ({
    visible: typeof document === "undefined" || !document.hidden,
    motion: typeof window === "undefined" || typeof window.matchMedia !== "function" || !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const check = () => {
      const visible = !document.hidden && !root.current?.closest("[hidden], [inert]");
      const motion = !media.matches && !root.current?.closest('[data-motion="off"]');
      setEnvironment(previous => previous.visible === visible && previous.motion === motion ? previous : { visible, motion });
    };
    const observer = new MutationObserver(check);
    for (let element: HTMLElement | null = root.current; element !== null; element = element.parentElement) {
      observer.observe(element, { attributes: true, attributeFilter: ["hidden", "inert", "data-motion"] });
    }
    document.addEventListener("visibilitychange", check);
    media.addEventListener("change", check);
    check();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", check);
      media.removeEventListener("change", check);
    };
  }, [root]);
  return { active: active && environment.visible, motion: environment.motion };
}
