// Start instance. Two settings, both needed together:
// - requestMiddleware: Start installs its default CSRF middleware for server functions only when this file does not
//   exist (createStartHandler in @tanstack/start-server-core: `requestMiddleware: startInstance ?
//   startOptions.requestMiddleware : isServerFnRequest ? [defaultCsrfMiddleware] : undefined`). Having this file
//   drops that default, so the same middleware, with the same filter, is registered here.
//   Docs: tanstack.com/start/latest/docs/framework/react/guide/middleware#csrf-middleware
// - serverFns.fetch: the client's fetch for every server function, which recovers from a WAF challenge
//   (src/lib/server-fn-fetch.ts). Docs: same page, "Global Fetch via createStart".
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { serverFnFetch } from "@/lib/server-fn-fetch";

export const csrfMiddleware = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
  serverFns: { fetch: serverFnFetch },
}));
