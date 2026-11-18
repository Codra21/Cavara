// Names shared by the browser (the widget's `action`) and the server (the action Siteverify must report).

export const TURNSTILE_ACTIONS = ["order", "coupon"] as const;

/** The widget's `action` for each protected function; the server refuses a token minted for another one. */
export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[number];
