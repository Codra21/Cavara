import { Link } from "@tanstack/react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@ui-sdk/react/popover";
import { useEffect, useRef, useState } from "react";
import { NAV_LINKS } from "@/lib/config";
import { scrollToHomeSection } from "@/lib/dom";
import { pluralize } from "@/domain/catalog";
import { useStore } from "@/components/store/StoreProvider";
import { BrandLogo, Icon, SrOnly } from "@/components/ui/primitives";
import { HeaderSearch } from "./HeaderSearch";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [tucked, setTucked] = useState(false);
  const countRef = useRef<HTMLSpanElement>(null);
  const menusOpen = useRef(false);
  menusOpen.current = menuOpen || searchOpen;

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

  // Replay the bump animation whenever something is added.
  useEffect(() => {
    const count = countRef.current;
    if (!count || !bagBump) return;
    count.classList.remove("is-bumped");
    void count.offsetWidth;
    count.classList.add("is-bumped");
  }, [bagBump]);

  const bagLabel = `Open cart, ${pluralize(bagCount, "item")}`;
  const classes = ["site-header", scrolled && "is-scrolled", tucked && !menuOpen && !searchOpen && "is-tucked"]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={classes} id="top">
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <div className="container-wide header-inner">
          <div className="header-start">
            <PopoverTrigger className="icon-button menu-toggle">
              <Icon name={`fa-solid ${menuOpen ? "fa-xmark" : "fa-bars"}`} />
              <SrOnly>{menuOpen ? "Close menu" : "Open menu"}</SrOnly>
            </PopoverTrigger>
            <button
              className="icon-button header-search-mobile"
              type="button"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((v) => !v)}
            >
              <Icon name="fa-solid fa-magnifying-glass" />
              <SrOnly>Search products</SrOnly>
            </button>
            <Link className="brand" to="/" aria-label="Cavara home">
              <BrandLogo />
            </Link>
          </div>

          <nav className="primary-nav" aria-label="Primary">
            {NAV_LINKS.map((link) =>
              "to" in link ? (
                <Link key={link.label} to={link.to}>
                  {link.label}
                </Link>
              ) : (
                <Link
                  key={link.label}
                  to="/"
                  hash={link.hash}
                  onClick={(event) => scrollToHomeSection(event, link.hash)}
                >
                  {link.label}
                </Link>
              ),
            )}
          </nav>

          <div className="header-actions">
            <button
              className="icon-button header-search"
              type="button"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((v) => !v)}
            >
              <Icon name="fa-solid fa-magnifying-glass" />
              <SrOnly>Search products</SrOnly>
            </button>
            <ThemeToggle />
            <button className="bag-button" type="button" aria-label={bagLabel} onClick={openBag}>
              <Icon name="fa-solid fa-cart-shopping" />
              <span className="bag-count" ref={countRef}>
                {bagCount}
              </span>
            </button>
          </div>
        </div>

        <PopoverContent inline initialFocus="none" className="mobile-nav">
          <div className="container">
            <nav aria-label="Mobile">
              {NAV_LINKS.map((link) =>
                "to" in link ? (
                  <Link key={link.label} to={link.to} onClick={() => setMenuOpen(false)}>
                    {link.label}
                  </Link>
                ) : (
                  <Link
                    key={link.label}
                    to="/"
                    hash={link.hash}
                    onClick={(event) => {
                      setMenuOpen(false);
                      scrollToHomeSection(event, link.hash);
                    }}
                  >
                    {link.label}
                  </Link>
                ),
              )}
            </nav>
          </div>
        </PopoverContent>
      </Popover>
      <HeaderSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
