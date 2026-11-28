import { PHILOSOPHY_BODY, PHILOSOPHY_HEADING, type PhilosophyConfig } from "@/domain/home-settings";
import { useEffect, useRef } from "react";
import { pluralize, topLevelCategories } from "@/domain/catalog";
import { mediaUrl } from "@/domain/media";
import { CategoryLink } from "@/components/shop/CategoryLink";
import { useCategories } from "@/lib/query";

const delay = (ms: number) => ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties;

export function CollectionsSection({ heading }: { heading?: string } = {}) {
  const { categories } = useCategories();
  return (
    <section className="section collections" id="collections" aria-labelledby="collections-title">
      <div className="container-wide">
        <div className="section-head" data-reveal="">
          <p className="sub-heading">Shop by categories</p>
          <h2 id="collections-title">{heading || "Our collections"}</h2>
        </div>
        <ul className="studio-category-row" aria-label="Collections">
          {topLevelCategories(categories).map((category, index) => (
            <li key={category.id} data-reveal="" style={delay(index * 90)}>
              <CategoryLink className="studio-category" category={category.id}>
                <span className="studio-category-media">
                  <img src={category.image} alt="" loading="lazy" width={800} height={1000} />
                </span>
                <span className="studio-category-label">
                  <span className="studio-category-name">{category.name}</span>
                  <span className="studio-category-count">{pluralize(category.count, "piece")}</span>
                </span>
              </CategoryLink>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function StorySection({ heading, philosophy }: { heading?: string; philosophy?: PhilosophyConfig } = {}) {
  const { imageBase } = useCategories();
  // Pictures from the home editor replace the original pair one for one; the copy falls back to the original text.
  const images = philosophy?.images ?? [];
  const pictures = [
    {
      src:
        images[0] || mediaUrl(imageBase, "product-images/Ceramic-Seasoning-Bottle-21/Ceramic-Seasoning-Bottle1.webp"),
      alt: images[0] ? "" : "Hand-decorated ceramic seasoning bottles on a kitchen counter",
      height: 1000,
    },
    {
      src: images[1] || mediaUrl(imageBase, "product-images/vintage-Ceramic-Oil-Pot-22/vintage-Ceramic-Oil-Pot1.webp"),
      alt: images[1] ? "" : "Two vintage ceramic oil pots on a wooden tray",
      height: 800,
    },
  ];
  return (
    <section className="section story" id="story" aria-labelledby="story-title">
      <div className="container story-grid">
        <div className="story-media" data-reveal="">
          {pictures.map((picture) => (
            <img
              key={picture.src}
              src={picture.src}
              alt={picture.alt}
              loading="lazy"
              width={800}
              height={picture.height}
            />
          ))}
        </div>
        <div className="story-copy" data-reveal="">
          <p className="sub-heading">{philosophy?.eyebrow || heading || "Our philosophy"}</p>
          <h2 id="story-title">{philosophy?.heading || PHILOSOPHY_HEADING}</h2>
          <p className="story-lede">{philosophy?.body || PHILOSOPHY_BODY}</p>
          <ul className="principles">
            <li>
              <h3>Global selection</h3>
              <p>Artistry sourced from the world's most talented international artisans.</p>
            </li>
            <li>
              <h3>Premium quality</h3>
              <p>Each item is hand-selected for its craftsmanship and material excellence.</p>
            </li>
            <li>
              <h3>Classic design</h3>
              <p>Curated pieces that transcend seasonal trends to last a lifetime.</p>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { title: "Build your cart", body: "Choose your pieces, colours and quantities. Your cart is saved on this device." },
  {
    title: "Check out",
    body: "Enter your name, mobile number and address. Prefer chat? Send your cart on WhatsApp or Messenger instead.",
  },
  {
    title: "We call to confirm",
    body: "Our team calls to confirm delivery. Pay cash on delivery or by mobile banking; nothing is charged online.",
  },
];

export function OrderingSection({ heading }: { heading?: string } = {}) {
  const fancyRef = useRef<HTMLParagraphElement>(null);

  // Giant outline text fills in as the panel scrolls through the viewport.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const element = fancyRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const progress = Math.min(
        1,
        Math.max(0, (window.innerHeight - rect.top) / (window.innerHeight * 0.75 + rect.height)),
      );
      element.style.setProperty("--fill", `${Math.round(progress * 1000) / 10}%`);
    };
    const queue = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue, { passive: true });
    return () => {
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section className="ordering" id="ordering" aria-labelledby="ordering-title">
      <div className="container-wide">
        <div className="ordering-panel">
          <div className="ordering-head" data-reveal="">
            <h2 id="ordering-title">{heading || "How ordering works"}</h2>
            <p>Build your cart here, check out in a minute, and our team calls you to confirm.</p>
          </div>
          <ol className="steps">
            {STEPS.map((item, index) => (
              <li key={item.title} data-reveal="" style={delay(index * 110)}>
                <span className="step-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </li>
            ))}
          </ol>
          <div className="studio-fancy" aria-hidden="true">
            <p className="studio-fancy-text" ref={fancyRef}>
              everyday rituals
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
