import { createFileRoute } from "@tanstack/react-router";
import {
  CONTACT_EMAIL,
  FACEBOOK_URL,
  MESSENGER_URL,
  SITE_URL,
  WHATSAPP_DISPLAY,
  WHATSAPP_NUMBER,
  WHATSAPP_URL,
} from "@/lib/config";
import { Icon } from "@/components/ui/primitives";

export const Route = createFileRoute("/contact")({
  head: () => ({
    links: [{ rel: "canonical", href: `${SITE_URL}/contact` }],
    meta: [
      { title: "Contact Cavara — WhatsApp, Messenger & Dhaka Studio" },
      {
        name: "description",
        content:
          "Reach Cavara on WhatsApp, Facebook Messenger, phone, or email for product questions, pre-orders, and delivery support across Bangladesh.",
      },
      { property: "og:url", content: `${SITE_URL}/contact` },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <section className="section">
      <div className="container" style={{ maxWidth: "46rem" }}>
        <p className="sub-heading">Contact</p>
        <h1>Talk to the Cavara team.</h1>
        <p className="story-lede" style={{ marginTop: "1rem" }}>
          Need extra photos of a glaze, help matching pieces for a gift, or an update on your delivery? Message us
          directly — we reply fastest on WhatsApp and Messenger.
        </p>

        <div style={{ display: "grid", gap: "1.25rem", marginTop: "2rem" }}>
          <div>
            <h2>Direct messages</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.5rem" }}>
              <a className="button" href={WHATSAPP_URL} target="_blank" rel="noopener">
                <Icon name="fa-brands fa-whatsapp" /> WhatsApp ({WHATSAPP_DISPLAY})
              </a>
              <a className="button button-outline" href={MESSENGER_URL} target="_blank" rel="noopener">
                <Icon name="fa-brands fa-facebook-messenger" /> Facebook Messenger
              </a>
            </div>
          </div>

          <div>
            <h2>Phone &amp; email</h2>
            <p>
              Phone: <a href={`tel:+${WHATSAPP_NUMBER}`}>{WHATSAPP_DISPLAY}</a>
              <br />
              Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              <br />
              Facebook:{" "}
              <a href={FACEBOOK_URL} target="_blank" rel="noopener">
                facebook.com/cavarabd
              </a>
            </p>
          </div>

          <div>
            <h2>Address</h2>
            <address style={{ fontStyle: "normal" }}>
              West Nandipara, South Banasree
              <br />
              Dhaka, Bangladesh
            </address>
            <p style={{ marginTop: "0.5rem", opacity: 0.8 }}>
              Support hours (draft for review): Saturday – Thursday, 10:00 AM – 8:00 PM (BST).
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
