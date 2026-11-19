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
  const running = !paused && !held && !pageHidden;

  const show = (next: number) => setIndex(((next % total) + total) % total);

  useEffect(() => setPaused(prefersReducedMotion()), []);

  useEffect(() => {
    const onVisibility = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % total), SLIDE_INTERVAL);
    return () => window.clearInterval(timer);
  }, [running, index, total]);

  return (
    <section
      ref={sectionRef}
      className={`studio-hero${running ? " is-running" : ""}`}
      aria-roledescription="carousel"
      aria-labelledby="studio-hero-title"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(Boolean(sectionRef.current?.contains(document.activeElement)))}
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
