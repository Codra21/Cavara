import { useEffect, useRef } from "react";
import { finePointer, prefersReducedMotion } from "@/lib/dom";
import { useStore } from "@/components/store/StoreProvider";
import { useShopNavigation } from "./useShopNavigation";

const MEDIA_WRAPPERS =
  ".product-media, .product-dialog-media, .studio-slide-media, .studio-category-media, .studio-promo-media, .studio-lookbook-media, .studio-carousel-media, .pdp-shot";

/** Fade-up scroll reveals for every `[data-reveal]` element, including ones rendered later. */
function useReveals() {
  useEffect(() => {
    if (prefersReducedMotion() || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    const scan = (root: ParentNode) => {
      root.querySelectorAll("[data-reveal]:not(.is-revealed)").forEach((element) => observer.observe(element));
    };
    document.documentElement.classList.add("has-reveal");
    scan(document);
    const mutations = new MutationObserver((records) => {
      records.forEach((record) =>
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches("[data-reveal]:not(.is-revealed)")) observer.observe(node);
          scan(node);
        }),
      );
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      observer.disconnect();
      document.documentElement.classList.remove("has-reveal");
    };
  }, []);
}

/** Custom "Prev / Next / Drag / Explore" cursor over the hero, carousel and lookbook. */
function StudioCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const cursor = cursorRef.current;
    const label = labelRef.current;
    if (!cursor || !label || prefersReducedMotion() || !finePointer()) return;
    const position = { x: 0, y: 0, tx: 0, ty: 0, frame: 0 };
    const render = () => {
      position.x += (position.tx - position.x) * 0.22;
      position.y += (position.ty - position.y) * 0.22;
      cursor.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
      position.frame =
        Math.abs(position.tx - position.x) + Math.abs(position.ty - position.y) > 0.4
          ? window.requestAnimationFrame(render)
          : 0;
    };
    const zones: { selector: string; label: (event: PointerEvent, zone: Element) => string }[] = [
      {
        selector: ".studio-slide-media",
        label: (event, zone) =>
          event.clientX < zone.getBoundingClientRect().left + zone.clientWidth / 2 ? "Prev" : "Next",
      },
      { selector: "[data-carousel-track]", label: () => "Drag" },
      { selector: ".studio-lookbook-media img", label: () => "Explore" },
    ];
    const hide = () => {
      cursor.classList.remove("is-visible");
      document.documentElement.classList.remove("cursor-hidden");
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const target = event.target as Element;
      const match = zones
        .map((zone) => ({ zone, element: target.closest?.(zone.selector) }))
        .find((item) => item.element);
      const overControl = target.closest?.("button:not(.studio-carousel-card), a, input, select");
      if (!match?.element || (overControl && !target.closest(".studio-carousel-card"))) {
        hide();
        return;
      }
      label.textContent = match.zone.label(event, match.element);
      position.tx = event.clientX;
      position.ty = event.clientY;
      if (!cursor.classList.contains("is-visible")) {
        position.x = position.tx;
        position.y = position.ty;
      }
      cursor.classList.add("is-visible");
      document.documentElement.classList.add("cursor-hidden");
      if (!position.frame) position.frame = window.requestAnimationFrame(render);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", hide);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", hide);
      window.cancelAnimationFrame(position.frame);
      hide();
    };
  }, []);

  return (
    <div className="studio-cursor" aria-hidden="true" ref={cursorRef}>
      <span ref={labelRef} />
    </div>
  );
}

export function GlobalEffects() {
  const { quickView, bagOpen } = useStore();
  const goToShop = useShopNavigation();
  const dialogOpen = quickView !== null || bagOpen;
  const dialogOpenRef = useRef(dialogOpen);
  dialogOpenRef.current = dialogOpen;

  useReveals();

  useEffect(() => {
    document.body.classList.toggle("is-locked", dialogOpen);
  }, [dialogOpen]);

  // "/" jumps to product search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as Element).matches?.("input, textarea, select");
      if (event.key !== "/" || typing || dialogOpenRef.current) return;
      event.preventDefault();
      void goToShop({ focusSearch: true });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goToShop]);

  // Broken images fall back to the tinted placeholder styling.
  useEffect(() => {
    const onError = (event: Event) => {
      if (event.target instanceof HTMLImageElement) event.target.closest(MEDIA_WRAPPERS)?.classList.add("media-failed");
    };
    document.addEventListener("error", onError, true);
    return () => document.removeEventListener("error", onError, true);
  }, []);

  return <StudioCursor />;
}
