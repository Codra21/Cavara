import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { formatPrice, getVariant, pluralize } from "@/domain/catalog";
import { useCatalog } from "@/lib/query";
import { MAX_QTY, MESSENGER_URL } from "@/lib/config";
import { bagSubtotal, copyText, orderMessage, whatsappUrl } from "@/lib/order";
import { Toast } from "@/components/layout/SiteChrome";
import { useShopNavigation } from "@/components/layout/useShopNavigation";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { Icon, Quantity, SrOnly } from "@/components/ui/primitives";
import { CheckoutForm, type PlacedOrder } from "./CheckoutForm";
import { formatPhone } from "@/domain/orders";
import { useStore } from "./StoreProvider";

export function BagDrawer() {
  const { bag, bagCount, bagOpen, closeBag, updateBagItem, clearBag, showToast } = useStore();
  const catalog = useCatalog();
  const navigate = useNavigate();
  const goToShop = useShopNavigation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const subtotal = bagSubtotal(catalog, bag);
  const [view, setView] = useState<"bag" | "checkout" | "placed">("bag");
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const placedRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (bagOpen) window.requestAnimationFrame(() => closeRef.current?.focus());
    // A finished order is shown once; reopening the bag starts fresh. The checkout draft survives closing.
    else setView((current) => (current === "placed" ? "bag" : current));
  }, [bagOpen]);

  // An emptied bag cannot be checked out.
  useEffect(() => {
    if (bagCount === 0 && view === "checkout") setView("bag");
  }, [bagCount, view]);

  function onPlaced(order: PlacedOrder) {
    setPlaced(order);
    setView("placed");
    clearBag();
  }

  // Move focus to the confirmation once it has rendered, so screen readers announce it.
  useEffect(() => {
    if (view === "placed") placedRef.current?.focus();
  }, [view]);

  return (
    <ModalDialog open={bagOpen} onClose={closeBag} className="bag-drawer" labelledBy="bag-title">
      <div className="dialog-surface bag-surface">
        <div className="bag-header">
          <div>
            <h2 id="bag-title">Your bag</h2>
            <p>{bagCount ? `${pluralize(bagCount, "item")} · ${formatPrice(subtotal)}` : "No items yet"}</p>
          </div>
          <button ref={closeRef} className="icon-button" type="button" onClick={closeBag}>
            <Icon name="fa-solid fa-xmark" />
            <SrOnly>Close bag</SrOnly>
          </button>
        </div>

        <div className="bag-body">
          {view === "checkout" ? <CheckoutForm bag={bag} onBack={() => setView("bag")} onPlaced={onPlaced} /> : null}
          {view === "placed" && placed ? (
            <div className="order-placed" role="status">
              <span className="bag-empty-icon" aria-hidden="true">
                <Icon name="fa-solid fa-check" />
              </span>
              <h3 ref={placedRef} tabIndex={-1}>
                Order received
              </h3>
              <p>
                Your order reference is <strong className="order-reference">{placed.reference}</strong>. Total{" "}
                {formatPrice(placed.total)}.
              </p>
              <p>
                We will call {formatPhone(placed.phone)} to confirm delivery and payment. Keep the reference for any
                questions.
              </p>
              <button
                className="button"
                type="button"
                onClick={() => {
                  closeBag();
                  void goToShop({ category: "all" });
                }}
              >
                Continue shopping
              </button>
            </div>
          ) : null}
          <ul className="bag-list" hidden={bagCount === 0 || view !== "bag"}>
            {bag.map((item) => {
              const product = catalog.productById.get(item.id);
              if (!product) return null;
              const variant = getVariant(product, item.variant);
              return (
                <li className="bag-item" key={`${item.id}-${item.variant}`}>
                  <button
                    className="bag-item-image"
                    type="button"
                    aria-label={`View ${product.name}`}
                    onClick={() => {
                      closeBag();
                      void navigate({
                        to: "/products/$slug",
                        params: { slug: product.slug },
                        search: { variant: item.variant },
                      });
                    }}
                  >
                    <img src={variant.images[0]} alt="" loading="lazy" width={168} height={210} />
                  </button>
                  <div>
                    <h3>{product.name}</h3>
                    <p className="bag-item-variant">
                      {variant.name} · {formatPrice(product.price)} each
                    </p>
                    <div className="bag-item-controls">
                      <Quantity
                        value={item.qty}
                        min={0}
                        max={MAX_QTY}
                        label={`Quantity for ${product.name}`}
                        onChange={(next) => updateBagItem(item.id, item.variant, next)}
                      />
                      <button
                        className="bag-remove"
                        type="button"
                        onClick={() => {
                          updateBagItem(item.id, item.variant, 0);
                          showToast(`${product.name} removed`, { inBag: true });
                          if (bag.length === 1) window.requestAnimationFrame(() => browseRef.current?.focus());
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <p className="bag-item-price">{formatPrice(product.price * item.qty)}</p>
                </li>
              );
            })}
          </ul>
          <div className="bag-empty" hidden={bagCount > 0 || view !== "bag"}>
            <span className="bag-empty-icon" aria-hidden="true">
              <Icon name="fa-solid fa-bag-shopping" />
            </span>
            <h3>Your bag is empty</h3>
            <p>Add a few pieces you love, then check out in a minute. We call to confirm.</p>
            <button
              ref={browseRef}
              className="button"
              type="button"
              onClick={() => {
                closeBag();
                void goToShop({ category: "all" });
              }}
            >
              Browse the collection
            </button>
          </div>
        </div>

        <div className="bag-footer" hidden={bagCount === 0 || view !== "bag"}>
          <div className="bag-total">
            <span>Subtotal</span>
            <strong>{formatPrice(subtotal)}</strong>
          </div>
          <p>
            Delivery {catalog.deliveryZones.map((zone) => `${zone.name} ${formatPrice(zone.charge)}`).join(" · ")}. We
            call to confirm every order before it ships.
          </p>
          <button className="button" type="button" onClick={() => setView("checkout")}>
            Checkout
          </button>
          <a
            className="button button-outline"
            href={bagCount ? whatsappUrl(orderMessage(catalog, bag)) : "#"}
            target="_blank"
            rel="noopener"
          >
            <Icon name="fa-brands fa-whatsapp" /> Order on WhatsApp instead
          </a>
          <a
            className="button button-outline"
            href={MESSENGER_URL}
            target="_blank"
            rel="noopener"
            onClick={async () => {
              const copied = await copyText(orderMessage(catalog, bag));
              showToast(
                copied ? "Order copied. Paste it into Messenger." : "Messenger opened. Please list your pieces there.",
                { inBag: true },
              );
            }}
          >
            <Icon name="fa-brands fa-facebook-messenger" /> Copy order for Messenger
          </a>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              clearBag();
              window.requestAnimationFrame(() => browseRef.current?.focus());
            }}
          >
            Clear bag
          </button>
        </div>
        <Toast inDialog />
      </div>
    </ModalDialog>
  );
}
