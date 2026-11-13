// /healthz (src/routes/healthz.ts). The Worker answers on its own: no D1, R2 or catalogue read, so an uptime monitor
// polling it costs a Worker request and nothing else. It proves the Worker is deployed and running, not that the
// database is reachable.
export function healthResponse(): Response {
  return new Response("ok\n", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
