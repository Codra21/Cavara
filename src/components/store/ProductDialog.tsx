import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { availabilityTag, BAG_FULL_MESSAGE } from "@/domain/bag";
import { formatPrice, getVariant, pluralize } from "@/domain/catalog";
import { productQueryOptions } from "@/lib/query";
import { MAX_QTY, MESSENGER_URL } from "@/lib/config";
import { copyText, singleOrderMessage, whatsappUrl } from "@/lib/order";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { Icon, Quantity, SrOnly, Swatch } from "@/components/ui/primitives";
import { type QuickViewTarget, useStore } from "./StoreProvider";
import { PriceTag } from "./PriceTag";

const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

export function ProductDialog() {
  const { quickView, closeQuickView, selectedVariant, selectVariant, addToBag, openBag } = useStore();
  const navigate = useNavigate();
  // Keep the last product rendered while the close animation plays.
  const [target, setTarget] = useState<QuickViewTarget | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [feedback, setFeedback] = useState<{ message: string; bagAction: boolean } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (quickView === null) return;
    if (quickView.id !== target?.id) setQuantity(1);
    setTarget(quickView);
    setImageIndex(0);
    setFeedback(null);
    window.requestAnimationFrame(() => closeRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when a product is opened
  }, [quickView]);

  // The detail loads when the dialog opens (the same cache entry the product page uses). The slug comes from the card.
  const lookup = useQuery({
    ...productQueryOptions(target?.slug ?? ""),
    enabled: quickView !== null && target !== null,
  });
  const product = lookup.data?.product ?? undefined;
  const categoryName = lookup.data?.category?.name ?? "Collection";
  const picked = product ? selectedVariant(product.id) : 0;
  const variantIndex = product?.variants[picked] ? picked : 0;
  const variant = product ? getVariant(product, variantIndex) : undefined;
  const stockTag = availabilityTag(variant?.availability);
  const images = variant?.images ?? [];
  const current = Math.min(imageIndex, Math.max(0, images.length - 1));

  const step = (delta: number) => {
    if (images.length < 2) return;
    setImageIndex((index) => (index + delta + images.length) % images.length);
  };

  // Restart the image fade on every change.
  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    image.style.animation = "none";
    void image.offsetWidth;
    image.style.animation = "";
  }, [current, variantIndex, product?.id]);

  useEffect(() => {
    if (quickView === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        !(event.target as Element).matches?.(".swatch, input")
      ) {
        step(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <ModalDialog
      open={quickView !== null}
      onClose={closeQuickView}
      className="product-dialog"
      labelledBy="product-dialog-title"
    >
      <div className="dialog-surface product-dialog-surface">
        <button ref={closeRef} className="icon-button dialog-close" type="button" onClick={closeQuickView}>
          <Icon name="fa-solid fa-xmark" />
          <SrOnly>Close product details</SrOnly>
        </button>
        <div className="product-dialog-gallery">
          <div className="product-dialog-media">
            {product ? (
              <img
                ref={imageRef}
                src={images[current] ?? BLANK}
                alt={`${product.name}, ${variant?.name ?? ""}, image ${current + 1} of ${images.length}`}
                width={800}
                height={800}
              />
            ) : target ? (
              <span className="skeleton skeleton-media" aria-hidden="true" />
            ) : null}
            <button
              className="gallery-arrow gallery-prev"
              type="button"
              hidden={images.length < 2}
              onClick={() => step(-1)}
            >
              <Icon name="fa-solid fa-arrow-left" />
              <SrOnly>Previous image</SrOnly>
            </button>
            <button
              className="gallery-arrow gallery-next"
              type="button"
              hidden={images.length < 2}
              onClick={() => step(1)}
            >
              <Icon name="fa-solid fa-arrow-right" />
              <SrOnly>Next image</SrOnly>
            </button>
            <span className="gallery-count" hidden={images.length < 2}>
              {current + 1} / {images.length}
            </span>
          </div>
          <div className="product-dialog-thumbs" hidden={product ? images.length < 2 : false}>
            {!product && target
              ? [0, 1, 2].map((slot) => <span className="thumb skeleton" key={slot} aria-hidden="true" />)
              : null}
            {images.map((image, index) => (
              <button
                key={image}
                className="thumb"
                type="button"
                aria-current={index === current}
                aria-label={`Show image ${index + 1} of ${images.length}`}
                onClick={() => setImageIndex(index)}
              >
                <img src={image} alt="" loading="lazy" width={136} height={136} />
              </button>
            ))}
          </div>
        </div>

        {product && variant ? (
          <div className="product-dialog-info">
            <p className="product-dialog-category">{categoryName}</p>
            <h2 id="product-dialog-title">{product.name}</h2>
            <p className="product-dialog-price">
              <PriceTag price={product.price} regularPrice={product.regularPrice} sale={product.sale} />
              {product.sale ? <span className="sale-badge">{product.sale.badge}</span> : null}
            </p>
            <p className="product-dialog-summary">{product.summary}</p>

            <fieldset className="variant-picker">
              <legend>
                Color: <span>{variant.name}</span>
                {stockTag ? <span className="stock-tag">{stockTag}</span> : null}
              </legend>
              <div className="variant-swatches">
                {product.variants.map((item, index) => (
                  <Swatch
                    key={item.name}
                    variant={item}
                    selected={index === variantIndex}
                    size="large"
                    onSelect={() => {
                      selectVariant(product.id, index);
                      setImageIndex(0);
                      setFeedback(null);
                    }}
                  />
                ))}
              </div>
            </fieldset>

            <div className="purchase-row">
              <Quantity
                value={quantity}
                max={MAX_QTY}
                onChange={(next) => setQuantity(Math.min(MAX_QTY, Math.max(1, next)))}
              />
              <button
                className="button purchase-add"
                type="button"
                disabled={stockTag !== null}
                onClick={() => {
                  if (!addToBag(product.id, variantIndex, quantity)) {
                    setFeedback({ message: BAG_FULL_MESSAGE, bagAction: true });
                    return;
                  }
                  setFeedback({ message: `${pluralize(quantity, "item")} added · ${variant.name}`, bagAction: true });
                }}
              >
                <Icon name="fa-solid fa-bag-shopping" />
                <span>{stockTag ?? `Add to bag · ${formatPrice(product.price * quantity)}`}</span>
              </button>
            </div>
            <p className="dialog-feedback" role="status" aria-live="polite" hidden={!feedback}>
              {feedback ? (
                <>
                  <span>{feedback.message}</span>
                  {feedback.bagAction ? (
                    <button type="button" onClick={openBag}>
                      View bag
                    </button>
                  ) : null}
                </>
              ) : null}
            </p>

            <div className="direct-order">
              <a
                className="button button-outline"
                href={whatsappUrl(singleOrderMessage(product, variant, quantity))}
                target="_blank"
                rel="noopener"
              >
                <Icon name="fa-brands fa-whatsapp" /> Order on WhatsApp
              </a>
              <a
                className="button button-outline"
                href={MESSENGER_URL}
                target="_blank"
                rel="noopener"
                onClick={async () => {
                  const copied = await copyText(singleOrderMessage(product, variant, quantity));
                  setFeedback({
                    message: copied
                      ? "Order copied. Paste it into Messenger."
                      : "Messenger opened. Tell us the piece and colour you want.",
                    bagAction: false,
                  });
                }}
              >
                <Icon name="fa-brands fa-facebook-messenger" /> Order on Messenger
              </a>
            </div>
            <button
              className="text-link dialog-page-link"
              type="button"
              onClick={() => {
                closeQuickView();
                void navigate({ to: "/products/$slug", params: { slug: product.slug } });
              }}
            >
              View full details <Icon name="fa-solid fa-arrow-right" />
            </button>

            <div className="product-details">
              <h3>Details</h3>
              <ul>
                {product.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
              {product.note ? <p className="product-note">{product.note}</p> : null}
            </div>
          </div>
        ) : !target ? (
          <div className="product-dialog-info">
            <h2 id="product-dialog-title" className="sr-only">
              Product details
            </h2>
          </div>
        ) : lookup.isPending ? (
          <div className="product-dialog-info is-loading" role="status" aria-busy="true">
            <h2 id="product-dialog-title" className="sr-only">
              Loading product details
            </h2>
            <span className="skeleton skeleton-line is-eyebrow" aria-hidden="true" />
            <span className="skeleton skeleton-line is-heading" aria-hidden="true" />
            <span className="skeleton skeleton-line is-price" aria-hidden="true" />
            <span className="skeleton skeleton-line is-text" aria-hidden="true" />
            <span className="skeleton skeleton-line is-text" aria-hidden="true" />
            <span className="skeleton skeleton-line is-swatches" aria-hidden="true" />
            <span className="skeleton skeleton-line is-buy" aria-hidden="true" />
            <span className="skeleton skeleton-line is-buy" aria-hidden="true" />
          </div>
        ) : (
          <div className="product-dialog-info">
            <h2 id="product-dialog-title">
              {lookup.isError ? "We couldn't load this product" : "This piece is no longer available"}
            </h2>
            <p className="product-dialog-summary">
              {lookup.isError
                ? "Check your connection and try again."
                : "It may have been removed from the shop. Browse the collection for something similar."}
            </p>
            {lookup.isError ? (
              <button
                className="button button-outline dialog-retry"
                type="button"
                onClick={() => void lookup.refetch()}
              >
                Try again
              </button>
            ) : (
              <button className="button dialog-retry" type="button" onClick={closeQuickView}>
                Back to the shop
              </button>
            )}
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
