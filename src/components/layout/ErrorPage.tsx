import type { ErrorComponentProps } from "@tanstack/react-router";
import { BrandLogo, Icon } from "@/components/ui/primitives";
import { WHATSAPP_URL } from "@/lib/config";

/**
 * The page shown when rendering or a loader fails. TanStack Router sets the HTTP status of a server render that ends
 * in an error boundary to 500 (router-core load-server.ts, applyFailure), so crawlers and monitors see a real 500.
 * The error itself is never rendered: its message and stack stay in the Worker log.
 *
 * `standalone` is for the root boundary, which replaces the whole layout (no header or footer), so it carries its
 * own logo. Child routes fail inside the layout and leave it out.
 */
export function ServerErrorPage({
  error,
  standalone = false,
}: Pick<ErrorComponentProps, "error"> & { standalone?: boolean }) {
  // Server render only: log once to the Worker log (the router swallows loader errors, so nothing else would).
  if (typeof document === "undefined") console.error("page render failed:", error);

  return (
    <section className={standalone ? "section error-page" : "section"}>
      <div className="container">
        {standalone ? (
          <a className="brand error-page-brand" href="/" aria-label="Cavara home">
            <BrandLogo />
          </a>
        ) : null}
        <div className="empty-state" role="alert">
          <Icon name="fa-solid fa-triangle-exclamation" />
          <h1>Something went wrong</h1>
          <p>
            We could not load this page. Your bag stays saved on this device. Try again in a moment, or message us on
            WhatsApp and we will take your order there.
          </p>
          <div className="error-page-actions">
            <button className="button" type="button" onClick={() => window.location.reload()}>
              Try again
            </button>
            <a className="button button-outline" href="/">
              Back to the shop
            </a>
            <a className="button button-outline" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
              WhatsApp us
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function RootErrorPage({ error }: ErrorComponentProps) {
  return <ServerErrorPage error={error} standalone />;
}

export function RouteErrorPage({ error }: ErrorComponentProps) {
  return <ServerErrorPage error={error} />;
}
