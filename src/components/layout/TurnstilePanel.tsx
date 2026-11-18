import { useEffect } from "react";
import { startTurnstile } from "@/lib/turnstile";

/**
 * Home of the Turnstile widgets (src/lib/turnstile.ts). Invisible while the check passes by itself; when it needs the
 * visitor the module sets `data-active` and the panel shows the widget under a short line. Starting after mount keeps
 * the script out of the server render and out of hydration.
 */
export function TurnstilePanel() {
  useEffect(() => {
    startTurnstile();
  }, []);
  return (
    <div className="turnstile-panel" id="turnstile-panel" role="region" aria-label="Security check">
      <p>Quick check before we continue</p>
      <div id="turnstile-slot" />
    </div>
  );
}
