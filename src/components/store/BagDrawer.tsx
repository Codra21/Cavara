import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { bagOrderMessage, bagSubtotal, blockedLines, canCheckout, isBuyable, type BagLine } from "@/domain/bag";
import { formatPrice, pluralize } from "@/domain/catalog";
import { MAX_QTY, MESSENGER_URL } from "@/lib/config";
import { copyText, whatsappUrl } from "@/lib/order";
import { Toast } from "@/components/layout/SiteChrome";
import { useShopNavigation } from "@/components/layout/useShopNavigation";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { Icon, Quantity, SrOnly } from "@/components/ui/primitives";
import { CheckoutForm, type CheckoutDraft, EMPTY_DRAFT, type PlacedOrder } from "./CheckoutForm";
import { formatPhone } from "@/domain/orders";
import { useBagLines } from "./useBagLines";
import { useStore } from "./StoreProvider";
import { PriceTag } from "./PriceTag";

/** A line whose details are still loading. Same grid as `.bag-item`, so the drawer does not jump when they arrive. */
function BagLineSkeleton() {
  return (
    <li className="bag-item is-loading" aria-hidden="true">
      <span className="bag-item-image skeleton" />
      <div>
        <span className="skeleton skeleton-line is-title" />
        <span className="skeleton skeleton-line is-meta" />
        <span className="skeleton skeleton-line is-controls" />
      </div>
      <span className="skeleton skeleton-line is-price" />
    </li>
  );
}

export function BagDrawer() {
  const { bag, bagCount, bagOpen, closeBag, updateBagItem, clearBag, showToast } = useStore();
  const { lines, zones, failed, retry } = useBagLines(bag, bagOpen);
  const navigate = useNavigate();
  const goToShop = useShopNavigation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const subtotal = bagSubtotal(lines);
  const settled = lines.every((line) => line.status !== "pending");
  // Pieces the shop no longer sells are not counted once the lookup has said so.
  const itemCount = settled
    ? lines.reduce((sum, line) => (line.status === "unavailable" ? sum : sum + line.item.qty), 0)
    : bagCount;
  const blocked = blockedLines(lines);
  const buyable = lines.filter(isBuyable);
  const ready = canCheckout(lines);
  const [view, setView] = useState<"bag" | "checkout" | "placed">("bag");
  const [draft, setDraft] = useState<CheckoutDraft>(EMPTY_DRAFT);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const placedRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // A finished order is shown once; reopening the bag starts fresh. The checkout draft survives closing.
    if (!bagOpen) setView((current) => (current === "placed" ? "bag" : current));
  }, [bagOpen]);

  // An emptied bag cannot be checked out, and neither can one that holds a line the shop no longer sells.
  useEffect(() => {
    if (view === "checkout" && !ready) setView("bag");
  }, [ready, view]);

  function onPlaced(order: PlacedOrder) {
    setPlaced(order);
    setView("placed");
    setDraft(EMPTY_DRAFT);
    clearBag();
  }

  // Move focus to the confirmation once it has rendered, so screen readers announce it.
  useEffect(() => {
    if (view === "placed") placedRef.current?.focus();
  }, [view]);

  const remove = (line: BagLine, name: string) => {
    updateBagItem(line.item.id, line.item.variant, 0);
    showToast(`${name} removed`, { inBag: true });
    if (bag.length === 1) window.requestAnimationFrame(() => browseRef.current?.focus());
  };

  return (
    <ModalDialog open={bagOpen} onClose={closeBag} className="bag-drawer" labelledBy="bag-title">
      <div className="dialog-surface bag-surface">
        <div className="bag-header">
          <div>
            <h2 id="bag-title">Your cart</h2>
            <p>
              {bagCount
                ? !settled && !failed
                  ? `${pluralize(itemCount, "item")} · Loading details…`
                  : `${pluralize(itemCount, "item")}${settled && !failed ? ` · ${formatPrice(subtotal)}` : ""}`
                : "No items yet"}
            </p>
          </div>
          <button ref={closeRef} className="icon-button" type="button" onClick={closeBag}>
            <Icon name="fa-solid fa-xmark" />
            <SrOnly>Close cart</SrOnly>
          </button>
        </div>

        <div className="bag-body">
          {view === "checkout" && ready ? (
            <CheckoutForm
              lines={buyable}
              zones={zones}
              draft={draft}
              onDraftChange={setDraft}
              onBack={() => setView("bag")}
              onPlaced={onPlaced}
            />
          ) : null}
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
            {failed
              ? null
              : lines.map((line) => {
                  const { item } = line;
                  const key = `${item.id}-${item.variant}`;
                  if (line.status === "pending") return <BagLineSkeleton key={key} />;
                  if (line.status === "unavailable") {
                    // The bag stores ids only, so a product that is gone has no name left to show.
                    const name = line.product?.name ?? "This piece";
                    return (
                      <li className="bag-item is-unavailable" key={key}>
                        <span className="bag-item-image">
                          {line.product?.images[0] ? (
                            <img src={line.product.images[0]} alt="" width={168} height={210} />
                          ) : null}
                        </span>
                        <div>
                          <h3>{line.product ? line.product.name : "No longer available"}</h3>
                          <p className="bag-item-variant">
                            {line.product
                              ? "This colour is no longer available."
                              : "It was removed from the shop since you added it."}
                          </p>
                          <div className="bag-item-controls">
                            <span className="stock-tag">Unavailable</span>
                            <button className="bag-remove" type="button" onClick={() => remove(line, name)}>
                              Remove
                            </button>
                          </div>
                        </div>
                        <p className="bag-item-price">—</p>
                      </li>
                    );
                  }
                  const { product, variant } = line;
                  const image = variant.image ?? product.images[0];
                  return (
                    <li className={`bag-item${line.status === "out_of_stock" ? " is-unavailable" : ""}`} key={key}>
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
                        {image ? <img src={image} alt="" loading="lazy" width={168} height={210} /> : null}
                      </button>
                      <div>
                        <h3>{product.name}</h3>
                        <p className="bag-item-variant">
                          {variant.name} ·{" "}
                          <PriceTag price={product.price} regularPrice={product.regularPrice} sale={product.sale} />{" "}
                          each
                        </p>
                        <div className="bag-item-controls">
                          {line.status === "ok" ? (
                            <Quantity
                              value={item.qty}
                              min={0}
                              max={MAX_QTY}
                              label={`Quantity for ${product.name}`}
                              onChange={(next) =>
                                next <= 0 ? remove(line, product.name) : updateBagItem(item.id, item.variant, next)
                              }
                            />
                          ) : (
                            <span className="stock-tag">Sold out</span>
                          )}
                          <button className="bag-remove" type="button" onClick={() => remove(line, product.name)}>
                            Remove
                          </button>
                        </div>
                      </div>
                      <p className="bag-item-price">
                        {line.status === "ok" ? formatPrice(product.price * item.qty) : "—"}
                      </p>
                    </li>
                  );
                })}
          </ul>
          {failed && bagCount > 0 && view === "bag" ? (
            <div className="bag-error" role="alert">
              <p>We couldn&apos;t load the items in your cart. Check your connection and try again.</p>
              <button className="button button-outline" type="button" onClick={retry}>
                Try again
              </button>
            </div>
          ) : null}
          <div className="bag-empty" hidden={bagCount > 0 || view !== "bag"}>
            <span className="bag-empty-icon" aria-hidden="true">
              <Icon name="fa-solid fa-cart-shopping" />
            </span>
            <h3>Your cart is empty</h3>
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
            <strong>{settled && !failed ? formatPrice(subtotal) : "—"}</strong>
          </div>
          {blocked.length > 0 ? (
            <p className="bag-notice" role="status">
              Remove the items marked unavailable or out of stock to check out.
            </p>
          ) : null}
          <p>
            {zones.length
              ? `Delivery ${zones.map((zone) => `${zone.name} ${formatPrice(zone.charge)}`).join(" · ")}. `
              : ""}
            We call to confirm every order before it ships.
          </p>
          <button className="button" type="button" disabled={!ready} onClick={() => setView("checkout")}>
            Checkout
          </button>
          <div className="bag-footer-alt">
            {/* The buttons are one word each; this line says what they do (WhatsApp prefills, Messenger copies). */}
            <p className="bag-footer-alt-label">Or send your order by message</p>
            <a
              className="button button-outline"
              href={buyable.length ? whatsappUrl(bagOrderMessage(lines)) : "#"}
              aria-disabled={buyable.length === 0}
              target="_blank"
              rel="noopener"
              onClick={(event) => {
                if (buyable.length === 0) event.preventDefault();
              }}
            >
              <Icon name="fa-brands fa-whatsapp" /> WhatsApp
            </a>
            <a
              className="button button-outline"
              href={MESSENGER_URL}
              target="_blank"
              rel="noopener"
              aria-disabled={buyable.length === 0}
              onClick={async (event) => {
                if (buyable.length === 0) {
                  event.preventDefault();
                  return;
                }
                const copied = await copyText(bagOrderMessage(lines));
                showToast(
                  copied
                    ? "Order copied. Paste it into Messenger."
                    : "Messenger opened. Please list your pieces there.",
                  { inBag: true },
                );
              }}
            >
              <Icon name="fa-brands fa-facebook-messenger" /> Messenger
            </a>
          </div>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              clearBag();
              window.requestAnimationFrame(() => browseRef.current?.focus());
            }}
          >
            Clear cart
          </button>
        </div>
        <Toast inDialog />
      </div>
    </ModalDialog>
  );
}
