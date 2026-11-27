import { createFileRoute } from "@tanstack/react-router";
import { SITE_URL, WHATSAPP_DISPLAY, WHATSAPP_URL } from "@/lib/config";

export const Route = createFileRoute("/delivery-returns")({
  head: () => ({
    links: [{ rel: "canonical", href: `${SITE_URL}/delivery-returns` }],
    meta: [
      { title: "Delivery & Returns — Cavara" },
      {
        name: "description",
        content: "Delivery timelines, charges across Bangladesh, and return or replacement policy for Cavara orders.",
      },
      { property: "og:url", content: `${SITE_URL}/delivery-returns` },
    ],
  }),
  component: DeliveryReturnsPage,
});

function DeliveryReturnsPage() {
  return (
    <section className="section">
      <div className="container" style={{ maxWidth: "46rem" }}>
        <p className="sub-heading">Policy · Draft for Owner review</p>
        <h1>Delivery &amp; returns</h1>

        <div style={{ display: "grid", gap: "1.5rem", marginTop: "1.75rem" }}>
          <div>
            <h2>Delivery across Bangladesh</h2>
            <p>
              Orders are confirmed by phone before dispatch. Typical delivery takes 1–3 working days inside Dhaka and
              3–5 working days outside Dhaka. Delivery charges depend on delivery area and total parcel weight, shown
              clearly at checkout.
            </p>
          </div>
          <div>
            <h2>Damaged or incorrect items (review window)</h2>
            <p>
              Because ceramics and glassware are fragile, please inspect your parcel in front of the delivery rider or
              record a short unboxing video. If a piece arrives broken, chipped, or wrong, message us on{" "}
              <a href={WHATSAPP_URL} target="_blank" rel="noopener">
                WhatsApp ({WHATSAPP_DISPLAY})
              </a>{" "}
              within 48 hours of delivery (Owner to confirm exact window) for a free replacement or refund.
            </p>
          </div>
          <div>
            <h2>Returns &amp; exchanges (Owner to confirm)</h2>
            <p>
              Unused items in original packaging may be eligible for exchange within 7 days of delivery (Owner to
              confirm return window, return courier responsibility, and exchange terms). Pre-order items confirmed with
              a 50% advance are non-refundable once sourced unless damaged in transit.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
