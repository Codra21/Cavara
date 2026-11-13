// Security headers for every Worker response (src/server.ts wraps the Start handler with applySecurityHeaders).
// Static assets are served by Workers Assets before the Worker runs, so they never pass through here; public/_headers
// repeats the same headers for them (developers.cloudflare.com/workers/static-assets/headers/).
// Pure module, no Cloudflare imports, so bun:test can run it.

const SECONDS_PER_YEAR = 31_536_000;

/** One year, subdomains included. No `preload`: it is a long-lived commitment, added later if the Owner wants it. */
export const HSTS = `max-age=${SECONDS_PER_YEAR}; includeSubDomains`;

/** Switches off browser features the shop never uses, so a script injected later cannot ask for them. */
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

export const REFERRER_POLICY = "strict-origin-when-cross-origin";

/** Enforced on every page. The clickjacking half of CSP, kept apart from the report-only policy below. */
export const FRAME_ANCESTORS_POLICY = "frame-ancestors 'none'";

/** Where the shop's pictures come from when they are not served by the Worker's own /media route. */
export function imageOrigin(imageBase: string): string | null {
  try {
    const url = new URL(imageBase);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Report-only policy listing what the site loads today. Violations show in the browser console; nothing is blocked.
 * - script-src 'unsafe-inline': TanStack Start streams inline hydration scripts and THEME_BOOT is inline. Dropping it
 *   needs a nonce on each (`ssr.nonce`), which belongs to the task that adds GTM and the Pixel (P5.2).
 * - style-src 'unsafe-inline': React inline `style` attributes (reveal delays, swatches) and Vite's dev styles.
 * - cdnjs.cloudflare.com: Font Awesome (stylesheet imported by app.css, plus its webfonts). Remove it when the icons
 *   are self-hosted.
 * - Fonts: self-hosted under /fonts, so font-src has no Google origins.
 * - data: images: the 1x1 placeholder GIF in ProductDialog.
 * - Known report: Zod probes `Function("")` once per page to pick its fast path and falls back when it is blocked, so an
 *   enforced policy without 'unsafe-eval' still works. Set `z.config({ jitless: true })` to silence it before enforcing.
 */
export function contentSecurityPolicyReportOnly(imagesOrigin: string | null = null): string {
  const imgSrc = ["'self'", "data:", ...(imagesOrigin ? [imagesOrigin] : [])];
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
    "font-src 'self' https://cdnjs.cloudflare.com",
    `img-src ${imgSrc.join(" ")}`,
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    FRAME_ANCESTORS_POLICY,
  ].join("; ");
}

export interface SecurityHeaderOptions {
  /** Origin of the R2 custom domain, when images skip the Worker (see imageOrigin). */
  imagesOrigin?: string | null;
}

function isHtml(response: Response): boolean {
  return (response.headers.get("Content-Type") ?? "").toLowerCase().startsWith("text/html");
}

/**
 * Returns the response with the security headers added. A header the route already set is left alone, so a route
 * (or the admin's `Cache-Control: private, no-store`) always wins. Builds a new Response because the headers of
 * `Response.redirect()` and of fetched responses are immutable.
 * - Every response: nosniff, Referrer-Policy, Permissions-Policy, and HSTS when the request came over https.
 * - HTML responses also: enforced `frame-ancestors 'none'` with `X-Frame-Options: DENY` for old browsers, and the
 *   report-only policy.
 */
export function applySecurityHeaders(
  response: Response,
  request: Request,
  options: SecurityHeaderOptions = {},
): Response {
  const headers = new Headers(response.headers);
  const addIfMissing = (name: string, value: string) => {
    if (!headers.has(name)) headers.set(name, value);
  };

  addIfMissing("X-Content-Type-Options", "nosniff");
  addIfMissing("Referrer-Policy", REFERRER_POLICY);
  addIfMissing("Permissions-Policy", PERMISSIONS_POLICY);
  if (new URL(request.url).protocol === "https:") addIfMissing("Strict-Transport-Security", HSTS);

  if (isHtml(response)) {
    addIfMissing("X-Frame-Options", "DENY");
    addIfMissing("Content-Security-Policy", FRAME_ANCESTORS_POLICY);
    addIfMissing("Content-Security-Policy-Report-Only", contentSecurityPolicyReportOnly(options.imagesOrigin));
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
