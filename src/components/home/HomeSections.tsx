import { useEffect, useRef, useState } from "react";
import { CATEGORIES, PRODUCTS, categoryById, countInCategory, formatPrice, getVariant, pluralize, productById } from "@/lib/catalog";
import { CAROUSEL_CATEGORY, LOOKBOOK, PROMO_PRODUCT_ID } from "@/lib/config";
import { scrollBehavior } from "@/lib/dom";
import { useShopNavigation } from "@/components/layout/useShopNavigation";
import { useOpenProduct } from "@/components/store/useOpenProduct";
import { Icon, RoundBadge } from "@/components/ui/primitives";

const delay = (ms: number) => ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties;

export function CollectionsSection() {
  const goToShop = useShopNavigation();
  return (
    <section className="section collections" id="collections" aria-labelledby="collections-title">
      <div className="container-wide">
        <div className="section-head" data-reveal="">
          <p className="sub-heading">Shop by categories</p>
          <h2 id="collections-title">Our collections</h2>
        </div>
        <ul className="studio-category-row" aria-label="Collections">
          {CATEGORIES.map((category, index) => (
            <li key={category.id} data-reveal="" style={delay(index * 90)}>
              <button className="studio-category" type="button" onClick={() => goToShop({ category: category.id })}>
                <span className="studio-category-media">
                  <img src={category.image} alt="" loading="lazy" width={800} height={1000} />
                </span>
                <span className="studio-category-label">
                  <span className="studio-category-name">{category.name}</span>
                  <span className="studio-category-count">{pluralize(countInCategory(category.id), "piece")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function LookbookSection() {
  const openProduct = useOpenProduct();
  const [openSpot, setOpenSpot] = useState<number | null>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const product = productById.get(LOOKBOOK.productId);

  useEffect(() => {
    if (openSpot === null) return;
    const onClick = (event: MouseEvent) => {
      if (!(event.target as Element).closest?.(".studio-spot")) setOpenSpot(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      buttonRefs.current[openSpot]?.focus();
      setOpenSpot(null);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openSpot]);

  if (!product) return null;
  const lead = getVariant(product);

  return (
    <section className="studio-lookbook" aria-labelledby="studio-lookbook-title">
      <div className="container-wide">
        <div className="studio-lookbook-grid">
          <div className="studio-lookbook-media" data-reveal="">
            <img src={LOOKBOOK.image} alt={`${product.name} in ${product.variants.length} glazes, styled on a breakfast table`} loading="lazy" width={800} height={800} />
            {LOOKBOOK.spots.map((spot, index) => {
              const variant = getVariant(product, spot.variant);
              const open = openSpot === index;
              const side = spot.x < 35 ? " is-start" : spot.x > 65 ? " is-end" : "";
              return (
                <div key={index} className={`studio-spot${side}${open ? " is-open" : ""}`} style={{ "--x": `${spot.x}%`, "--y": `${spot.y}%` } as React.CSSProperties}>
                  <button
                    ref={(element) => {
                      buttonRefs.current[index] = element;
                    }}
                    className="studio-spot-button"
                    type="button"
                    aria-expanded={open}
                    aria-controls={`lookbook-spot-${index}`}
                    aria-label={`${product.name}, ${variant.name}`}
                    onClick={() => setOpenSpot(open ? null : index)}
                  >
                    <span aria-hidden="true" />
                  </button>
                  <div className="studio-spot-card" id={`lookbook-spot-${index}`} hidden={!open}>
                    <img src={variant.images[0]} alt="" loading="lazy" width={160} height={160} />
                    <div>
                      <p className="studio-spot-name">{product.name}</p>
                      <p className="studio-spot-meta">
                        {variant.name} · {formatPrice(product.price)}
                      </p>
                      <button className="text-link" type="button" onClick={() => openProduct(product, spot.variant)}>
                        View piece
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="studio-lookbook-copy" data-reveal="">
            <span className="studio-lookbook-word" aria-hidden="true">
              glazes
            </span>
            <p className="sub-heading">Shop the table</p>
            <h2 id="studio-lookbook-title">One dish, {product.variants.length} glazes, set for breakfast.</h2>
            <p className="studio-lookbook-note">Tap a marker to see each colour of the {product.name}, then open it to choose yours.</p>
            <button className="studio-lookbook-card" type="button" onClick={() => openProduct(product)}>
              <span className="studio-lookbook-card-media">
                <img src={lead.images[0]} alt="" loading="lazy" width={400} height={400} />
              </span>
              <span className="studio-lookbook-card-name">{product.name}</span>
              <span className="studio-lookbook-card-price">{formatPrice(product.price)} each</span>
            </button>
            <button className="button" type="button" onClick={() => openProduct(product)}>
              Shop the look <Icon name="fa-solid fa-arrow-right" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CarouselSection() {
  const openProduct = useOpenProduct();
  const trackRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const category = categoryById.get(CAROUSEL_CATEGORY);
  const products = PRODUCTS.filter((product) => product.category === CAROUSEL_CATEGORY);

  const updateEdges = () => {
    const track = trackRef.current;
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth - 2;
    setEdges({ start: track.scrollLeft <= 2, end: track.scrollLeft >= max });
  };

  // Mouse drag-to-scroll; the click that ends a drag is swallowed so cards don't open.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let drag: { startX: number; scroll: number; moved: boolean } | null = null;
    const onDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse") drag = { startX: event.clientX, scroll: track.scrollLeft, moved: false };
    };
    const onMove = (event: PointerEvent) => {
      if (!drag) return;
      const delta = event.clientX - drag.startX;
      if (Math.abs(delta) > 4) {
        drag.moved = true;
        track.classList.add("is-dragging");
      }
      if (drag.moved) track.scrollLeft = drag.scroll - delta;
    };
    const onUp = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      track.classList.remove("is-dragging");
      if (moved) {
        window.addEventListener(
          "click",
          (event) => {
            event.stopPropagation();
            event.preventDefault();
          },
          { capture: true, once: true }
        );
      }
    };
    track.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("resize", updateEdges, { passive: true });
    updateEdges();
    return () => {
      track.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("resize", updateEdges);
    };
  }, []);

  const step = (direction: number) => {
    const track = trackRef.current;
    if (!track) return;
    const item = track.querySelector(".studio-carousel-item");
    const distance = item ? item.getBoundingClientRect().width + 24 : track.clientWidth * 0.8;
    track.scrollBy({ left: direction * distance, behavior: scrollBehavior() });
  };

  if (!category) return null;

  return (
    <section className="section studio-carousel-section" aria-labelledby="studio-carousel-title">
      <div className="container-wide">
        <div className="section-head" data-reveal="">
          <p className="sub-heading">People also love · {pluralize(products.length, "piece")}</p>
          <h2 id="studio-carousel-title">The {category.name.toLowerCase()} edit</h2>
        </div>
        <div className="studio-carousel-arrows">
          <button className="studio-arrow" type="button" aria-label={`Scroll ${category.name} back`} disabled={edges.start} onClick={() => step(-1)}>
            <Icon name="fa-solid fa-arrow-left-long" />
          </button>
          <button className="studio-arrow" type="button" aria-label={`Scroll ${category.name} forward`} disabled={edges.end} onClick={() => step(1)}>
            <Icon name="fa-solid fa-arrow-right-long" />
          </button>
        </div>
      </div>
      <ul className="studio-carousel" data-carousel-track="" aria-label={category.name} ref={trackRef} onScroll={updateEdges}>
        {products.map((product) => {
          const variant = getVariant(product);
          return (
            <li className="studio-carousel-item" key={product.id}>
              <button className="studio-carousel-card" type="button" onClick={() => openProduct(product)}>
                <span className="studio-carousel-media">
                  <img src={variant.images[0]} alt="" loading="lazy" width={800} height={800} draggable={false} />
                </span>
                <span className="eyebrow">{product.variants.length > 1 ? pluralize(product.variants.length, "colour") : variant.name}</span>
                <span className="studio-carousel-name">{product.name}</span>
                <span className="studio-carousel-price">{formatPrice(product.price)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function PromoSection() {
  const openProduct = useOpenProduct();
  const promo = productById.get(PROMO_PRODUCT_ID);
  if (!promo) return null;
  const images = promo.variants.flatMap((variant) => variant.images);
  return (
    <section className="studio-promo" aria-labelledby="studio-promo-title">
      <div className="container-wide">
        <div className="studio-promo-grid" data-reveal="">
          <div className="studio-promo-media">
            <img src={images[1] ?? images[0]} alt={`${promo.name} in several painted designs`} loading="lazy" width={800} height={800} />
          </div>
          <RoundBadge value={String(promo.variants.length)} ringText="Painted by hand · No two alike · " caption="designs" />
          <div className="studio-promo-copy">
            <p className="sub-heading sub-heading-light">Painted by hand</p>
            <h2 id="studio-promo-title">{pluralize(promo.variants.length, "design")}, no two quite alike.</h2>
            <p>{promo.summary} Pick the pattern that suits your table, or mix a few for the family.</p>
            <p className="studio-promo-price">
              {promo.name} · {formatPrice(promo.price)}
            </p>
          </div>
          <button className="studio-promo-tab" type="button" onClick={() => openProduct(promo)}>
            Choose your design
          </button>
        </div>
      </div>
    </section>
  );
}

export function StorySection() {
  return (
    <section className="section story" id="story" aria-labelledby="story-title">
      <div className="container story-grid">
        <div className="story-media" data-reveal="">
          <img
            src="/product-images/Ceramic-Seasoning-Bottle-21/Ceramic-Seasoning-Bottle1.webp"
            alt="Hand-decorated ceramic seasoning bottles on a kitchen counter"
            loading="lazy"
            width={800}
            height={1000}
          />
          <img src="/product-images/vintage-Ceramic-Oil-Pot-22/vintage-Ceramic-Oil-Pot1.webp" alt="Two vintage ceramic oil pots on a wooden tray" loading="lazy" width={800} height={800} />
        </div>
        <div className="story-copy" data-reveal="">
          <p className="sub-heading">Our philosophy</p>
          <h2 id="story-title">Your home is a personal gallery of your journey.</h2>
          <p className="story-lede">
            We explore the globe to bring you inspiring home decor, exquisite ceramics, and premium kitchenware — pieces that turn ordinary moments into small rituals.
          </p>
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
  { title: "Build your bag", body: "Choose your pieces, colours and quantities. Your bag is saved on this device." },
  { title: "Send your order", body: "Checkout opens WhatsApp with your order written out, or copies it for Messenger." },
  { title: "Confirm the details", body: "Our team confirms availability, delivery and payment with you directly in chat." },
];

export function OrderingSection() {
  const fancyRef = useRef<HTMLParagraphElement>(null);

  // Giant outline text fills in as the panel scrolls through the viewport.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const element = fancyRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, (window.innerHeight - rect.top) / (window.innerHeight * 0.75 + rect.height)));
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
            <h2 id="ordering-title">How ordering works</h2>
            <p>Build your bag here, then finish your order in a conversation with our team.</p>
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
