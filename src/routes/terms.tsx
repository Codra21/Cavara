import { createFileRoute } from "@tanstack/react-router";
import { CONTACT_EMAIL, SITE_URL } from "@/lib/config";

export const Route = createFileRoute("/terms")({
  head: () => ({
    links: [{ rel: "canonical", href: `${SITE_URL}/terms` }],
    meta: [
      { title: "Terms & Conditions — Cavara" },
      {
        name: "description",
        content: "Terms of ordering, pricing, pre-orders, and delivery for Cavara Bangladesh.",
      },
      { property: "og:url", content: `${SITE_URL}/terms` },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <section className="section">
      <div className="container" style={{ maxWidth: "46rem" }}>
        <p className="sub-heading">Policy · Draft for Owner review</p>
        <h1>Terms &amp; conditions</h1>

        <div style={{ display: "grid", gap: "1.5rem", marginTop: "1.75rem" }}>
          <div>
            <h2>Orders &amp; confirmation</h2>
            <p>
              Placing an order on cavarabd.com submits an order request. Orders are confirmed after our team contacts
              you by phone or WhatsApp. We reserve the right to cancel orders if an item becomes unavailable or cannot
              be confirmed.
            </p>
          </div>
          <div>
            <h2>Pricing &amp; payment</h2>
            <p>
              All prices are listed in Bangladeshi Taka (৳). Payment is collected via cash on delivery or mobile banking
              (bKash / Nagad) as agreed during confirmation. Pre-order requests arranged on WhatsApp require a 50%
              advance payment (Owner to confirm final terms).
            </p>
          </div>
          <div>
            <h2>Handmade variations</h2>
            <p>
              Many Cavara pieces are hand-glazed or hand-painted, so slight variations in colour tone, glaze speckles,
              or brushwork are natural characteristics rather than defects. Questions can be sent to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
