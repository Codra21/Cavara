import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { pluralize } from "@/domain/catalog";
import {
  CONTACT_EMAIL,
  FACEBOOK_URL,
  MESSENGER_URL,
  WHATSAPP_DISPLAY,
  WHATSAPP_NUMBER,
  WHATSAPP_URL,
} from "@/lib/config";
import { useStore } from "@/components/store/StoreProvider";
import { scrollToHomeSection } from "@/lib/dom";
import { BrandLogo, Icon } from "@/components/ui/primitives";
import { useShopNavigation } from "./useShopNavigation";

export function SiteFooter() {
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
                  <Icon name="fa-brands fa-facebook-messenger" /> Message on Messenger{" "}
                  <Icon name="fa-solid fa-arrow-right" />
                </a>
              </div>
            </div>
            <div>
              <h2 className="footer-title">Explore</h2>
              <ul className="footer-links">
                <li>
                  <Link to="/products">All products</Link>
                </li>
                <li>
                  <Link to="/collections">Collections</Link>
                </li>
                <li>
                  <Link to="/about">About us</Link>
                </li>
                <li>
                  <Link to="/contact">Contact</Link>
                </li>
                <li>
                  <Link to="/delivery-returns">Delivery &amp; returns</Link>
                </li>
                <li>
                  <Link to="/privacy">Privacy policy</Link>
                </li>
                <li>
                  <Link to="/terms">Terms &amp; conditions</Link>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="footer-title">Help</h2>
              <ul className="footer-links">
                <li>
                  <Link to="/" hash="ordering" onClick={(event) => scrollToHomeSection(event, "ordering")}>
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
      <Link
        to="/"
        onClick={() => {
          if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      >
        <Icon name="fa-solid fa-house" />
        <span>Home</span>
      </Link>
      <button type="button" onClick={() => goToShop({ focusSearch: true })}>
        <Icon name="fa-solid fa-magnifying-glass" />
        <span>Search</span>
      </button>
      <Link to="/products">
        <Icon name="fa-solid fa-table-cells-large" />
        <span>Products</span>
      </Link>
      <a href={WHATSAPP_URL} target="_blank" rel="noopener">
        <Icon name="fa-brands fa-whatsapp" />
        <span>Chat</span>
      </a>
      <button type="button" aria-label={`Open cart, ${pluralize(bagCount, "item")}`} onClick={openBag}>
        <span className="studio-dock-icon">
          <Icon name="fa-solid fa-cart-shopping" />
          <span className="studio-dock-count">{bagCount}</span>
        </span>
        <span>Cart</span>
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
