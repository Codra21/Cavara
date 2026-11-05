import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { pluralize } from "@/domain/catalog";
import { useCatalog } from "@/lib/query";
import { CONTACT_EMAIL, FACEBOOK_URL, MESSENGER_URL, WHATSAPP_DISPLAY, WHATSAPP_NUMBER, WHATSAPP_URL } from "@/lib/config";
import { useStore } from "@/components/store/StoreProvider";
import { BrandLogo, Icon } from "@/components/ui/primitives";
import { useShopNavigation } from "./useShopNavigation";

const ANNOUNCEMENTS = (hidden: boolean) => (
  <ul className="announce-list" aria-hidden={hidden || undefined}>
    <li>Curated ceramics &amp; home accessories for modern Bangladeshi homes</li>
    <li>
      <a href={WHATSAPP_URL} target="_blank" rel="noopener" tabIndex={hidden ? -1 : undefined}>
        <Icon name="fa-brands fa-whatsapp" /> Order on WhatsApp · {WHATSAPP_DISPLAY}
      </a>
    </li>
    <li>Hand-selected from international artisans</li>
    <li>Based in South Banasree, Dhaka</li>
  </ul>
);

export function Announcement() {
  return (
    <div className="announce" aria-label="Announcements">
      <div className="announce-track">
        {ANNOUNCEMENTS(false)}
        {ANNOUNCEMENTS(true)}
      </div>
    </div>
  );
}

export function SiteFooter() {
  const catalog = useCatalog();
  const goToShop = useShopNavigation();
  const [year, setYear] = useState(2026);
  useEffect(() => setYear(new Date().getFullYear()), []);

  return (
    <footer className="site-footer" id="contact">
      <div className="container-wide">
        <div className="footer-panel" data-reveal="">
          <div className="footer-grid">
            <div className="footer-cta">
              <h2>Need help choosing?</h2>
              <p>Our team is here to help with orders, product details and personalized consultation.</p>
              <div className="footer-cta-links">
                <a className="link-arrow" href={WHATSAPP_URL} target="_blank" rel="noopener">
                  <Icon name="fa-brands fa-whatsapp" /> WhatsApp support <Icon name="fa-solid fa-arrow-right" />
                </a>
                <a className="link-arrow" href={MESSENGER_URL} target="_blank" rel="noopener">
                  <Icon name="fa-brands fa-facebook-messenger" /> Message on Messenger <Icon name="fa-solid fa-arrow-right" />
                </a>
              </div>
            </div>
            <div>
              <h2 className="footer-title">Shop</h2>
              <ul className="footer-links">
                {catalog.categories.map((category) => (
                  <li key={category.id}>
                    <button type="button" onClick={() => goToShop({ category: category.id })}>
                      {category.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="footer-title">Help</h2>
              <ul className="footer-links">
                <li>
                  <Link to="/" hash="ordering">
                    How to order
                  </Link>
                </li>
                <li>
                  <a href={WHATSAPP_URL} target="_blank" rel="noopener">
                    WhatsApp support
                  </a>
                </li>
                <li>
                  <a href={MESSENGER_URL} target="_blank" rel="noopener">
                    Messenger
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="footer-title">Visit us</h2>
              <address>
                West Nandipara, South Banasree
                <br />
                Dhaka, Bangladesh
              </address>
              <ul className="footer-links footer-contact">
                <li>
                  <a href={`tel:+${WHATSAPP_NUMBER}`}>{WHATSAPP_DISPLAY}</a>
                </li>
                <li>
                  <a href={`mailto:${CONTACT_EMAIL}`}>Email us</a>
                </li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <BrandLogo className="footer-logo" />
            <p>&copy; {year} Cavara. All rights reserved.</p>
            <div className="social-links">
              <a href={FACEBOOK_URL} target="_blank" rel="noopener" aria-label="Cavara on Facebook">
                <Icon name="fa-brands fa-facebook-f" />
              </a>
              <a href={WHATSAPP_URL} target="_blank" rel="noopener" aria-label="Cavara on WhatsApp">
                <Icon name="fa-brands fa-whatsapp" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function FloatingChat() {
  return (
    <a className="floating-chat" href={WHATSAPP_URL} target="_blank" rel="noopener">
      <Icon name="fa-brands fa-whatsapp" />
      <span>Chat with us</span>
    </a>
  );
}

export function QuickDock() {
  const { bagCount, openBag } = useStore();
  const goToShop = useShopNavigation();
  return (
    <nav className="studio-dock" aria-label="Quick links">
      <Link to="/" hash="top">
        <Icon name="fa-solid fa-house" />
        <span>Home</span>
      </Link>
      <button type="button" onClick={() => goToShop({ focusSearch: true })}>
        <Icon name="fa-solid fa-magnifying-glass" />
        <span>Search</span>
      </button>
      <Link to="/" hash="shop">
        <Icon name="fa-solid fa-table-cells-large" />
        <span>Shop</span>
      </Link>
      <a href={WHATSAPP_URL} target="_blank" rel="noopener">
        <Icon name="fa-brands fa-whatsapp" />
        <span>Chat</span>
      </a>
      <button type="button" aria-label={`Open bag, ${pluralize(bagCount, "item")}`} onClick={openBag}>
        <span className="studio-dock-icon">
          <Icon name="fa-solid fa-bag-shopping" />
          <span className="studio-dock-count">{bagCount}</span>
        </span>
        <span>Bag</span>
      </button>
    </nav>
  );
}

/** Global toast. While the bag drawer is open, bag-scoped toasts render inside it instead (top layer). */
export function Toast({ inDialog = false }: { inDialog?: boolean }) {
  const { toast, hideToast, bagOpen } = useStore();
  const showHere = Boolean(toast) && (inDialog ? toast?.inBag && bagOpen : !(toast?.inBag && bagOpen));
  return (
    <div className={inDialog ? "toast dialog-toast" : "toast"} role="status" aria-live="polite" hidden={!showHere}>
      {showHere && toast ? (
        <>
          <span>{toast.message}</span>
          {toast.actionLabel ? (
            <button
              type="button"
              onClick={() => {
                hideToast();
                toast.action?.();
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
