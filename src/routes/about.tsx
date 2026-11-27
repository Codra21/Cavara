import { createFileRoute, Link } from "@tanstack/react-router";
import { SITE_URL, WHATSAPP_URL } from "@/lib/config";
import { Icon } from "@/components/ui/primitives";

export const Route = createFileRoute("/about")({
  head: () => ({
    links: [{ rel: "canonical", href: `${SITE_URL}/about` }],
    meta: [
      { title: "About Cavara — Curated Home Decor in Bangladesh" },
      {
        name: "description",
        content:
          "Meet Cavara: curated ceramics, tableware, drinkware, and home accessories hand-selected for modern Bangladeshi homes.",
      },
      { property: "og:url", content: `${SITE_URL}/about` },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <section className="section">
      <div className="container" style={{ maxWidth: "46rem" }}>
        <p className="sub-heading">About us</p>
        <h1>Everyday rituals, thoughtfully curated.</h1>
        <p className="story-lede" style={{ marginTop: "1rem" }}>
          Cavara started in Dhaka with a simple idea: the cups you reach for every morning, the plates you set for
          guests, and the small objects on your shelves should feel considered and lasting.
        </p>

        <div style={{ display: "grid", gap: "1.5rem", marginTop: "2rem" }}>
          <div>
            <h2>What we look for</h2>
            <p>
              We source small-batch ceramics, glassware, serveware, and kitchen accents from workshops and artisans
              abroad. Every piece is inspected by hand in Dhaka before it joins the catalogue — checking glaze finish,
              weight, balance, and everyday practicality.
            </p>
          </div>
          <div>
            <h2>Personal ordering, no guesswork</h2>
            <p>
              We keep ordering simple: browse online, place an order without creating an account, and our team calls to
              confirm your delivery details. Pay cash on delivery or via mobile banking — nothing is charged on the
              site.
            </p>
          </div>
          <div>
            <h2>Draft note for review</h2>
            <p style={{ opacity: 0.8 }}>
              This draft is ready for the owners to personalise with Cavara&apos;s founding story, studio photos, and
              team details.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "2rem" }}>
          <Link className="button" to="/products">
            Browse all products
          </Link>
          <a className="button button-outline" href={WHATSAPP_URL} target="_blank" rel="noopener">
            <Icon name="fa-brands fa-whatsapp" /> Chat on WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}
