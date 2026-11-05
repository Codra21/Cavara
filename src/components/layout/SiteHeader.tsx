import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { NAV_LINKS } from "@/lib/config";
import { pluralize } from "@/lib/catalog";
import { useStore } from "@/components/store/StoreProvider";
import { BrandLogo, Icon, SrOnly } from "@/components/ui/primitives";
import { useShopNavigation } from "./useShopNavigation";

function ThemeToggle() {
  const { theme, toggleTheme } = useStore();
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button className="icon-button theme-toggle" type="button" onClick={toggleTheme} aria-label={label} title={label}>
      <Icon name={`fa-solid ${theme === "dark" ? "fa-sun" : "fa-moon"}`} />
    </button>
  );
}

export function SiteHeader() {
  const { bagCount, bagBump, openBag } = useStore();
  const goToShop = useShopNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [tucked, setTucked] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const menusOpen = useRef(false);
  menusOpen.current = menuOpen;

  // Shadow once scrolled; tuck away while scrolling down past the hero.
  useEffect(() => {
    let frame = 0;
    let lastY = window.scrollY;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled(y > 8);
      if (menusOpen.current || y < 480) setTucked(false);
      else if (Math.abs(y - lastY) > 4) setTucked(y > lastY);
      if (Math.abs(y - lastY) > 4) lastY = y;
    };
    const queue = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", queue, { passive: true });
    return () => {
      window.removeEventListener("scroll", queue);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuToggleRef.current?.focus();
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Replay the bump animation whenever something is added.
  useEffect(() => {
    const count = countRef.current;
    if (!count || !bagBump) return;
    count.classList.remove("is-bumped");
    void count.offsetWidth;
    count.classList.add("is-bumped");
  }, [bagBump]);

  const bagLabel = `Open bag, ${pluralize(bagCount, "item")}`;
  const classes = ["site-header", scrolled && "is-scrolled", tucked && !menuOpen && "is-tucked"].filter(Boolean).join(" ");

  return (
    <header className={classes} id="top" ref={headerRef}>
      <div className="container-wide header-inner">
        <div className="header-start">
          <button
            ref={menuToggleRef}
            className="icon-button menu-toggle"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name={`fa-solid ${menuOpen ? "fa-xmark" : "fa-bars"}`} />
            <SrOnly>{menuOpen ? "Close menu" : "Open menu"}</SrOnly>
          </button>
          <button className="icon-button header-search-mobile" type="button" onClick={() => goToShop({ focusSearch: true })}>
            <Icon name="fa-solid fa-magnifying-glass" />
            <SrOnly>Search products</SrOnly>
          </button>
          <Link className="brand" to="/" aria-label="Cavara home">
            <BrandLogo />
          </Link>
        </div>

        <nav className="primary-nav" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link key={link.hash} to="/" hash={link.hash}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <button className="icon-button header-search" type="button" onClick={() => goToShop({ focusSearch: true })}>
            <Icon name="fa-solid fa-magnifying-glass" />
            <SrOnly>Search products</SrOnly>
          </button>
          <ThemeToggle />
          <button className="bag-button" type="button" aria-label={bagLabel} onClick={openBag}>
            <Icon name="fa-solid fa-bag-shopping" />
            <span className="bag-count" ref={countRef}>
              {bagCount}
            </span>
          </button>
        </div>
      </div>

      <nav className="mobile-nav" id="mobile-nav" aria-label="Mobile" hidden={!menuOpen}>
        <div className="container">
          {NAV_LINKS.map((link) => (
            <Link key={link.hash} to="/" hash={link.hash} onClick={() => setMenuOpen(false)}>
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
