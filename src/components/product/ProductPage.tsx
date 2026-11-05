import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { formatPrice, getCategory, getVariant, pluralize, relatedProducts } from "@/domain/catalog";
import { useCatalog } from "@/lib/query";
import { MAX_QTY, MESSENGER_URL, SITE_URL, WHATSAPP_URL } from "@/lib/config";
import { finePointer } from "@/lib/dom";
import { copyText, singleOrderMessage, whatsappUrl } from "@/lib/order";
import type { Product } from "@/lib/types";
import { useShopNavigation } from "@/components/layout/useShopNavigation";
import { useStore } from "@/components/store/StoreProvider";
import { useOpenProduct } from "@/components/store/useOpenProduct";
import { Icon, Quantity, Swatch } from "@/components/ui/primitives";

const TABS = [
  { id: "description", label: "Description" },
  { id: "information", label: "Additional information" },
  { id: "ordering", label: "Ordering & delivery" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const FEATURE_ICONS = ["fa-ruler-combined", "fa-circle-half-stroke", "fa-palette", "fa-images"];

function PageCard({ product }: { product: Product }) {
  const catalog = useCatalog();
  const openProduct = useOpenProduct();
  return (
    <li className="pdp-card">
      <button className="studio-carousel-card" type="button" onClick={() => openProduct(product)}>
        <span className="studio-carousel-media">
          <img src={getVariant(product).images[0]} alt="" loading="lazy" width={800} height={800} />
        </span>
        <span className="eyebrow">{getCategory(catalog, product).name}</span>
        <span className="studio-carousel-name">{product.name}</span>
        <span className="studio-carousel-price">{formatPrice(product.price)}</span>
      </button>
    </li>
  );
}

function Gallery({ product, variantIndex }: { product: Product; variantIndex: number }) {
  const variant = getVariant(product, variantIndex);
  const images = variant.images;
  const ref = useRef<HTMLDivElement>(null);

  // Replay the gallery fade whenever the colour changes.
  useEffect(() => {
    const gallery = ref.current;
    if (!gallery) return;
    gallery.classList.remove("is-changing");
    void gallery.offsetWidth;
    gallery.classList.add("is-changing");
  }, [product.id, variantIndex]);

  const zoom = useFinePointer();
  return (
    <div className={`pdp-gallery${images.length === 1 ? " is-single" : ""}`} ref={ref} aria-label={`${product.name} photos`}>
      {images.map((image, index) => (
        <figure
          key={image}
          className={`pdp-shot${index === 0 ? " is-lead" : ""}`}
          onPointerMove={
            zoom
              ? (event) => {
                  const shot = event.currentTarget;
                  const rect = shot.getBoundingClientRect();
                  shot.style.setProperty("--zx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
                  shot.style.setProperty("--zy", `${((event.clientY - rect.top) / rect.height) * 100}%`);
                  shot.classList.add("is-zooming");
                }
              : undefined
          }
          onPointerLeave={zoom ? (event) => event.currentTarget.classList.remove("is-zooming") : undefined}
        >
          <img
            src={image}
            alt={`${product.name}, ${variant.name}, photo ${index + 1} of ${images.length}`}
            {...(index === 0 ? { fetchPriority: "high" as const } : { loading: "lazy" as const })}
            width={800}
            height={800}
          />
          <figcaption>
            {String(index + 1).padStart(2, "0")} / {String(images.length).padStart(2, "0")}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function useFinePointer() {
  const [fine, setFine] = useState(false);
  useEffect(() => setFine(finePointer()), []);
  return fine;
}

export function ProductPage({ product, initialVariant }: { product: Product; initialVariant?: number }) {
  const { selectedVariant, selectVariant, addToBag, showToast, openBag, recent, rememberViewed } = useStore();
  const catalog = useCatalog();
  const navigate = useNavigate();
  const goToShop = useShopNavigation();
  const [quantity, setQuantity] = useState(1);
  const [tab, setTab] = useState<TabId>("description");
  const [barVisible, setBarVisible] = useState(false);
  const buyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const category = getCategory(catalog, product);
  const variantIndex = selectedVariant(product.id);
  const variant = getVariant(product, variantIndex);
  const pageUrl = `${SITE_URL}/products/${product.slug}`;
  const colours = product.variants.map((item) => item.name).join(", ");
  const recentProducts = recent.filter((id) => id !== product.id).slice(0, 4).flatMap((id) => catalog.productById.get(id) ?? []);
  const bannerImage =
    product.variants.flatMap((item) => item.images).find((image) => !variant.images.includes(image)) ?? variant.images[variant.images.length - 1];
  const features = [
    ...(product.details ?? []),
    `${pluralize(product.variants.length, "colour")} available`,
    `${pluralize(product.variants.reduce((sum, item) => sum + item.images.length, 0), "photo")} to compare`,
  ].slice(0, 4);

  // New product: reset local state, apply ?variant=, remember it, focus the title.
  useEffect(() => {
    setQuantity(1);
    setTab("description");
    if (initialVariant !== undefined) selectVariant(product.id, initialVariant);
    rememberViewed(product.id);
    document.documentElement.dataset.view = "product";
    window.requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    return () => {
      delete document.documentElement.dataset.view;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per product
  }, [product.id]);

  // Sticky buy bar once the main buy row scrolls away.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const buy = buyRef.current;
      if (buy) setBarVisible(buy.getBoundingClientRect().bottom < 0);
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
  }, [product.id]);

  const add = () => {
    addToBag(product.id, variantIndex, quantity);
    showToast(`${pluralize(quantity, "item")} added · ${variant.name}`, { actionLabel: "View bag", action: openBag });
  };
  const addLabel = quantity > 1 ? `Add ${quantity} to bag` : "Add to bag";

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.findIndex((item) => item.id === tab);
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    const nextTab = TABS[next];
    if (!nextTab) return;
    setTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  return (
    <section className="pdp" aria-labelledby="pdp-title">
      <div className="container">
        <nav className="pdp-crumbs" aria-label="Breadcrumb">
          <ol>
            <li>
              <button type="button" onClick={() => navigate({ to: "/" })}>
                Home
              </button>
            </li>
            <li>
              <button type="button" onClick={() => goToShop({ category: category.id })}>
                {category.name}
              </button>
            </li>
            <li aria-current="page">{product.name}</li>
          </ol>
        </nav>

        <div className="pdp-main">
          <Gallery product={product} variantIndex={variantIndex} />

          <div className="pdp-info">
            <div className="pdp-sticky">
              <p className="eyebrow">
                {category.name}
                {product.variants.length > 1 ? ` · ${pluralize(product.variants.length, "colour")}` : ""}
              </p>
              <h1 id="pdp-title" tabIndex={-1} ref={titleRef}>
                {product.name}
              </h1>
              <p className="pdp-price">{formatPrice(product.price)}</p>
              <p className="pdp-summary">{product.summary}</p>
              {product.details?.length ? (
                <ul className="pdp-specs">
                  {product.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              ) : null}

              <div className="pdp-option">
                <p className="pdp-option-label">
                  Colour: <strong>{variant.name}</strong>
                </p>
                <div className="pdp-swatches" role="group" aria-label="Choose a colour">
                  {product.variants.map((item, index) => (
                    <Swatch key={item.name} variant={item} selected={index === variantIndex} size="large" onSelect={() => selectVariant(product.id, index)} />
                  ))}
                </div>
              </div>

              <div className="pdp-buy" ref={buyRef}>
                <Quantity value={quantity} max={MAX_QTY} onChange={(next) => setQuantity(Math.min(MAX_QTY, Math.max(1, next)))} />
                <button className="button pdp-add" type="button" onClick={add}>
                  {addLabel}
                </button>
              </div>
              <a className="button button-outline pdp-now" href={whatsappUrl(singleOrderMessage(product, variant, quantity))} target="_blank" rel="noopener">
                <Icon name="fa-brands fa-whatsapp" /> Order now on WhatsApp
              </a>

              <div className="pdp-links">
                <a href={MESSENGER_URL} target="_blank" rel="noopener">
                  <Icon name="fa-brands fa-facebook-messenger" /> Ask a question
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    const copied = await copyText(pageUrl);
                    showToast(copied ? "Link copied" : "Copy the link from your address bar");
                  }}
                >
                  <Icon name="fa-regular fa-copy" /> Copy link
                </button>
                <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`} target="_blank" rel="noopener">
                  <Icon name="fa-brands fa-facebook-f" /> Share
                </a>
              </div>

              <ul className="pdp-assurances">
                <li>
                  <Icon name="fa-regular fa-comments" />
                  <span>Order in a chat on WhatsApp or Messenger, no account needed.</span>
                </li>
                <li>
                  <Icon name="fa-regular fa-circle-check" />
                  <span>Availability, delivery and payment are confirmed with you before anything is final.</span>
                </li>
                <li>
                  <Icon name="fa-solid fa-location-dot" />
                  <span>Based in West Nandipara, South Banasree, Dhaka.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="pdp-tabs" data-reveal="">
          <div className="pdp-tablist" role="tablist" aria-label="Product information">
            {TABS.map((item) => (
              <button
                key={item.id}
                ref={(element) => {
                  tabRefs.current[item.id] = element;
                }}
                type="button"
                role="tab"
                id={`pdp-tab-${item.id}`}
                aria-controls={`pdp-panel-${item.id}`}
                aria-selected={item.id === tab}
                tabIndex={item.id === tab ? 0 : -1}
                onClick={() => setTab(item.id)}
                onKeyDown={onTabKey}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="pdp-panel" role="tabpanel" id="pdp-panel-description" aria-labelledby="pdp-tab-description" tabIndex={0} hidden={tab !== "description"}>
            <div className="pdp-story">
              <div>
                <p className="eyebrow">About this piece</p>
                <h2>{product.note || product.summary}</h2>
                <p>{product.summary} Each piece is selected by the Cavara team for everyday use and the way it looks on a real table.</p>
              </div>
              <ul className="pdp-features">
                {features.map((feature, index) => (
                  <li key={feature}>
                    <Icon name={`fa-solid ${FEATURE_ICONS[index]}`} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
            <figure className="pdp-banner">
              <img src={bannerImage} alt={product.name} loading="lazy" width={1400} height={700} />
            </figure>
          </div>

          <div className="pdp-panel" role="tabpanel" id="pdp-panel-information" aria-labelledby="pdp-tab-information" tabIndex={0} hidden={tab !== "information"}>
            <table className="pdp-table">
              <tbody>
                <tr>
                  <th scope="row">Name</th>
                  <td>{product.name}</td>
                </tr>
                <tr>
                  <th scope="row">Collection</th>
                  <td>{category.name}</td>
                </tr>
                <tr>
                  <th scope="row">{product.variants.length > 1 ? "Colours" : "Colour"}</th>
                  <td>{colours}</td>
                </tr>
                {product.details?.length ? (
                  <tr>
                    <th scope="row">Details</th>
                    <td>
                      {product.details.map((detail, index) => (
                        <span key={detail}>
                          {index > 0 ? <br /> : null}
                          {detail}
                        </span>
                      ))}
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <th scope="row">Price</th>
                  <td>{formatPrice(product.price)} per piece</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="pdp-panel" role="tabpanel" id="pdp-panel-ordering" aria-labelledby="pdp-tab-ordering" tabIndex={0} hidden={tab !== "ordering"}>
            <div className="pdp-ordering">
              <div>
                <h3>How ordering works</h3>
                <ol>
                  <li>Choose your colour and quantity, then add the piece to your bag.</li>
                  <li>Checkout sends your order to us on WhatsApp, or copies it for Messenger.</li>
                  <li>Our team confirms availability, delivery and payment with you in chat.</li>
                </ol>
              </div>
              <div>
                <h3>Questions before you order?</h3>
                <p>Ask us about sizes, colours or anything else. We are happy to send extra photos.</p>
                <div className="pdp-ordering-actions">
                  <a className="button" href={WHATSAPP_URL} target="_blank" rel="noopener">
                    <Icon name="fa-brands fa-whatsapp" /> WhatsApp us
                  </a>
                  <a className="text-link" href={MESSENGER_URL} target="_blank" rel="noopener">
                    Message on Messenger
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section className="pdp-related" aria-labelledby="pdp-related-title">
          <h2 id="pdp-related-title" data-reveal="">
            Related pieces
          </h2>
          <ul className="pdp-grid">
            {relatedProducts(catalog, product).map((item) => (
              <PageCard key={item.id} product={item} />
            ))}
          </ul>
        </section>

        {recentProducts.length ? (
          <section className="pdp-related" aria-labelledby="pdp-recent-title">
            <h2 id="pdp-recent-title" data-reveal="">
              Recently viewed
            </h2>
            <ul className="pdp-grid">
              {recentProducts.map((item) => (
                <PageCard key={item.id} product={item} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <div className={`pdp-bar${barVisible ? " is-visible" : ""}`} aria-hidden={!barVisible} inert={!barVisible}>
        <div className="container pdp-bar-inner">
          <img src={variant.images[0]} alt="" width={64} height={64} />
          <div className="pdp-bar-text">
            <p>{product.name}</p>
            <p>
              <span>{variant.name}</span> · {formatPrice(product.price)}
            </p>
          </div>
          <button className="button" type="button" onClick={add}>
            {addLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
