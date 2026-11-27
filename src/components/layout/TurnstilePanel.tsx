import { useEffect } from "react";
import { startTurnstile } from "@/lib/turnstile";

/**
 * Home of the pre-clearance widget (src/lib/turnstile.ts). Always clipped to nothing while someone browses. The module
 * sets `data-active` only when a click the shopper made was blocked and Cloudflare wants them to tick the box; then
 * the panel shows the widget in a centred card over the page. Starting after mount keeps the script out of the server
 * render and out of hydration.
 */
export function TurnstilePanel() {
  useEffect(() => {
    startTurnstile();
  }, []);
  return (
    <div className="turnstile-panel" id="turnstile-panel" aria-live="polite">
      <div className="turnstile-card" role="dialog" aria-labelledby="turnstile-title" aria-describedby="turnstile-text">
        <p className="turnstile-title" id="turnstile-title">
          One quick check
        </p>
        <p className="turnstile-text" id="turnstile-text">
          Tick the box to confirm you're a person. The page carries on by itself once it's done.
        </p>
        <div id="turnstile-slot" />
      </div>
    </div>
  );
}
