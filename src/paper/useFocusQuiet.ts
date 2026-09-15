import { useEffect, useState } from "react";

export function useFocusQuiet(enabled: boolean) {
  const [quiet, setQuiet] = useState(false);
  useEffect(() => {
    setQuiet(false);
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    let keyboard = false;
    const wake = (event?: Event) => {
      if (event?.type === "keydown") keyboard = true;
      if (event?.type.startsWith("pointer")) keyboard = false;
      setQuiet(false);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const focused = document.activeElement;
        if (
          focused instanceof HTMLElement &&
          (focused.closest("input,textarea,select,[role=menu]") ||
            (keyboard && focused.closest("button")))
        ) {
          wake();
        } else setQuiet(true);
      }, 10_000);
    };
    // Local interaction, not machine-wide inactivity: working elsewhere stays quiet.
    // Avoid pointerover: hiding a hovered control changes the hit target and
    // emits pointerover without user movement, immediately undoing the fade.
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "focus"];
    for (const event of events)
      window.addEventListener(event, wake, { passive: true });
    wake();
    return () => {
      clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, wake);
    };
  }, [enabled]);
  return enabled && quiet;
}
