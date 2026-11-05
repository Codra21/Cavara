import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PALETTES, NAV_LINKS } from "~/lib/config";
import { pluralize } from "~/lib/catalog";
import { useStore } from "~/components/store/StoreProvider";
import { BrandLogo, Icon, SrOnly } from "~/components/ui/primitives";
import { useShopNavigation } from "./useShopNavigation";

function PaletteDots({ colors }: { colors: readonly string[] }) {
  return (
    <>
      {colors.map((color) => (
        <i key={color} style={{ background: color }} />
      ))}
    </>
  );
}

function PalettePicker({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const { palette, setPalette } = useStore();
  const current = PALETTES.find((item) => item.id === palette) ?? PALETTES[0];
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLInputElement>('input[name="palette"]:checked')?.focus();
    const onClick = (event: MouseEvent) => {
      if (!(event.target as Element).closest?.("[data-palette-picker]")) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  return (
    <div className="palette-picker" data-palette-picker>
      <button
        ref={triggerRef}
        className="palette-trigger"
        type="button"
        aria-expanded={open}
        aria-controls="palette-menu"
        aria-label={`Color palette: ${current.name}`}
        onClick={() => setOpen(!open)}
      >
        <span className="palette-dots" aria-hidden="true">
          <PaletteDots colors={current.colors} />
        </span>
        <span className="palette-trigger-text">
          <span className="palette-trigger-label">Palette</span>
          <span className="palette-trigger-name">{current.name}</span>
        </span>
        <Icon name="fa-solid fa-chevron-down" />
      </button>
      <div className="palette-menu" id="palette-menu" hidden={!open} ref={menuRef}>
        <fieldset>
          <legend>Color palette</legend>
          <div
            className="palette-options"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                setOpen(false);
                triggerRef.current?.focus();
              }
            }}
          >
            {PALETTES.map((item) => (
              <label className="palette-option" key={item.id}>
                <input type="radio" name="palette" value={item.id} checked={item.id === palette} onChange={() => setPalette(item.id)} />
                <span className="palette-option-dots" aria-hidden="true">
                  <PaletteDots colors={item.colors} />
                </span>
                <span className="palette-option-text">
                  <span className="palette-option-name">{item.name}</span>
                  <span className="palette-option-note">{item.note}</span>
                </span>
                <Icon name="fa-solid fa-check" className="palette-option-check" />
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}

export function SiteHeader() {
  const { bagCount, bagBump, openBag } = useStore();
  const goToShop = useShopNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [tucked, setTucked] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const menusOpen = useRef(false);
  menusOpen.current = menuOpen || paletteOpen;

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
  const classes = ["site-header", scrolled && "is-scrolled", tucked && !menuOpen && !paletteOpen && "is-tucked"].filter(Boolean).join(" ");

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
          <PalettePicker open={paletteOpen} setOpen={setPaletteOpen} />
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
