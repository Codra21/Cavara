import { createFileRoute } from "@tanstack/react-router";
import { CONTACT_EMAIL, SITE_URL, WHATSAPP_DISPLAY } from "@/lib/config";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    links: [{ rel: "canonical", href: `${SITE_URL}/privacy` }],
    meta: [
      { title: "Privacy Policy — Cavara" },
      {
        name: "description",
        content: "How Cavara collects, uses, and protects your order details when you shop online.",
      },
      { property: "og:url", content: `${SITE_URL}/privacy` },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <section className="section">
      <div className="container" style={{ maxWidth: "46rem" }}>
        <p className="sub-heading">Policy · Draft for Owner review</p>
        <h1>Privacy policy</h1>

        <div style={{ display: "grid", gap: "1.5rem", marginTop: "1.75rem" }}>
          <div>
            <h2>What we collect</h2>
            <p>
              When you place an order, we collect only the details needed to confirm and deliver it: your name, mobile
              number, delivery address, delivery area, and any note you include. We do not require accounts or store
              card numbers.
            </p>
          </div>
          <div>
            <h2>Browser storage</h2>
            <p>
              Your cart, recently viewed products, and light/dark theme preference are stored locally on your device
              (localStorage) and are never sold or shared with third-party ad networks.
            </p>
          </div>
          <div>
            <h2>How we use your details</h2>
            <p>
              We use your phone number and address strictly to confirm your order, coordinate courier delivery, and
              provide customer support. To request deletion of your order contact details, email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> or message {WHATSAPP_DISPLAY}.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
