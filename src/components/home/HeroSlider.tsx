import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { formatPrice } from "@/domain/catalog";
import { useHome } from "@/lib/query";
import { HERO_SLIDES, SLIDE_INTERVAL } from "@/lib/config";
import { prefersReducedMotion } from "@/lib/dom";
import { useOpenProduct } from "@/components/store/useOpenProduct";
import { Icon } from "@/components/ui/primitives";

export function HeroSlider() {
  const home = useHome();
  const customBanners = useMemo(
    () => (home.settings?.banners ?? []).filter((b) => b.active && b.desktopImage),
    [home.settings?.banners],
  );
  const [bannerIndex, setBannerIndex] = useState(0);
  const bannerCount = customBanners.length;

  useEffect(() => {
    if (bannerCount <= 1 || prefersReducedMotion()) return;
    const timer = window.setTimeout(() => setBannerIndex((i) => (i + 1) % bannerCount), SLIDE_INTERVAL);
    return () => window.clearTimeout(timer);
  }, [bannerCount, bannerIndex]);

  if (bannerCount > 0) {
    const active = customBanners[bannerIndex % bannerCount]!;
    return (
      <section className="studio-hero" aria-label="Featured banners">
        <div className="container-wide">
          <div className="studio-hero-frame">
            <article className="studio-slide is-active" style={{ position: "relative" }}>
              <div className="studio-slide-media">
                <picture>
                  {active.mobileImage ? <source media="(max-width: 767px)" srcSet={active.mobileImage} /> : null}
                  <img src={active.desktopImage} alt={active.heading || "Cavara banner"} fetchPriority="high" />
                </picture>
              </div>
              {active.heading || active.buttonText ? (
                <div className="studio-slide-copy">
                  {active.heading ? <h2 className="studio-slide-title">{active.heading}</h2> : null}
                  {active.buttonText ? (
                    <div className="studio-slide-actions">
                      <a className="button" href={active.linkHref || "/products"}>
                        {active.buttonText}
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
            {bannerCount > 1 ? (
              <div className="studio-hero-controls">
                <button
                  type="button"
                  className="hero-nav"
                  aria-label="Previous banner"
                  onClick={() => setBannerIndex((i) => (i - 1 + bannerCount) % bannerCount)}
                >
                  <Icon name="fa-solid fa-chevron-left" />
                </button>
                <div className="hero-dots" role="tablist" aria-label="Choose banner">
                  {customBanners.map((b, idx) => (
                    <button
                      key={b.id ?? idx}
                      type="button"
                      role="tab"
                      aria-selected={idx === bannerIndex % bannerCount}
                      aria-label={`Banner ${idx + 1}`}
                      className={`hero-dot${idx === bannerIndex % bannerCount ? " is-active" : ""}`}
                      onClick={() => setBannerIndex(idx)}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="hero-nav"
                  aria-label="Next banner"
                  onClick={() => setBannerIndex((i) => (i + 1) % bannerCount)}
                >
                  <Icon name="fa-solid fa-chevron-right" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  const slides = useMemo(
    () =>
      HERO_SLIDES.flatMap((slide) => {
        const product = home.hero.find((item) => item.id === slide.id);
        return product
          ? [
              {
                ...slide,
                product,
                category: { id: product.category, name: home.categoryNames[product.category] ?? "" },
              },
            ]
          : [];
      }),
    [home],
  );
  const openProduct = useOpenProduct();
  const [index, setIndex] = useState(0);
  // No pause button: the slideshow stops while hovered or focused, and never runs with reduced motion.
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const total = slides.length;
  const running = total > 1 && !paused && !held && !pageHidden;

  const show = (next: number) => {
    if (total === 0) return;
    setIndex(((next % total) + total) % total);
  };

  useEffect(() => setPaused(prefersReducedMotion()), []);

  useEffect(() => {
    const onVisibility = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setIndex((current) => (current + 1) % total), SLIDE_INTERVAL);
    return () => window.clearTimeout(timer);
  }, [running, index, total]);

  if (total === 0) return null;

  return (
    <section
      ref={sectionRef}
      className={`studio-hero${running ? " is-running" : ""}`}
      aria-roledescription="carousel"
      aria-labelledby="studio-hero-title"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHeld(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setHeld(Boolean(sectionRef.current?.contains(document.activeElement)));
      }}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!sectionRef.current?.contains(event.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <h1 className="sr-only" id="studio-hero-title">
        Cavara — curated ceramics and home accessories
      </h1>
      <div className="container-wide">
        <div className="studio-hero-frame">
          <div className="studio-slides">
            {slides.map((slide, slideIndex) => {
              const active = slideIndex === index;
              const classes = ["studio-slide", active && "is-active", slideIndex < index && "is-before"]
                .filter(Boolean)
                .join(" ");
              return (
                <article
                  key={slide.id}
                  className={classes}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${slideIndex + 1} of ${total}: ${slide.product.name}`}
                  aria-hidden={!active}
                  inert={!active}
                >
                  <div
                    className="studio-slide-media"
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      show(index + (event.clientX < rect.left + rect.width / 2 ? -1 : 1));
                    }}
                  >
                    <img
                      src={slide.product.images[0]}
                      alt={slide.product.name}
                      {...(slideIndex === 0 ? { fetchPriority: "high" as const } : { loading: "lazy" as const })}
                      width={800}
                      height={800}
                    />
                  </div>
                  <span className="studio-slide-word" aria-hidden="true">
                    {slide.word}
                  </span>
                  <div className="studio-slide-copy">
                    <p className="eyebrow-line">{slide.eyebrow}</p>
                    <h2 className="studio-slide-title">{slide.title}</h2>
                    <p className="studio-slide-product">
                      {slide.product.name} <span>{formatPrice(slide.product.price)}</span>
                    </p>
                    <div className="studio-slide-actions">
                      <button className="button" type="button" onClick={() => openProduct(slide.product)}>
                        Shop now <Icon name="fa-solid fa-arrow-right" />
                      </button>
                      <Link className="text-link" to="/collections/$category" params={{ category: slide.category.id }}>
                        View {slide.category.name.toLowerCase()}
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="studio-hero-controls">
            <div className="studio-dots">
              {slides.map((slide, dotIndex) => (
                <button
                  key={slide.id}
                  className="studio-dot"
                  type="button"
                  aria-label={`Show slide ${dotIndex + 1}`}
                  aria-current={dotIndex === index ? "true" : undefined}
                  onClick={() => show(dotIndex)}
                >
                  <span />
                </button>
              ))}
            </div>
            <div className="studio-hero-buttons">
              <button
                className="studio-arrow"
                type="button"
                aria-label="Previous slide"
                onClick={() => show(index - 1)}
              >
                <Icon name="fa-solid fa-arrow-left-long" />
              </button>
              <button className="studio-arrow" type="button" aria-label="Next slide" onClick={() => show(index + 1)}>
                <Icon name="fa-solid fa-arrow-right-long" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
