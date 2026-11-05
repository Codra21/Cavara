import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { formatPrice, getCategory, getVariant, pluralize, productById } from "~/lib/catalog";
import { MAX_QTY, MESSENGER_URL } from "~/lib/config";
import { copyText, singleOrderMessage, whatsappUrl } from "~/lib/order";
import { ModalDialog } from "~/components/ui/ModalDialog";
import { Icon, Quantity, SrOnly, Swatch } from "~/components/ui/primitives";
import { useStore } from "./StoreProvider";

const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

export function ProductDialog() {
  const { quickView, closeQuickView, selectedVariant, selectVariant, addToBag, openBag } = useStore();
  const navigate = useNavigate();
  // Keep the last product rendered while the close animation plays.
  const [productId, setProductId] = useState<number | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [feedback, setFeedback] = useState<{ message: string; bagAction: boolean } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (quickView === null) return;
    if (quickView !== productId) setQuantity(1);
    setProductId(quickView);
    setImageIndex(0);
    setFeedback(null);
    window.requestAnimationFrame(() => closeRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when a product is opened
  }, [quickView]);

  const product = productId === null ? undefined : productById.get(productId);
  const variantIndex = product ? selectedVariant(product.id) : 0;
  const variant = product ? getVariant(product, variantIndex) : undefined;
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
  }, [current, variantIndex, productId]);

  useEffect(() => {
    if (quickView === null) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !(event.target as Element).matches?.(".swatch, input")) {
        step(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <ModalDialog open={quickView !== null} onClose={closeQuickView} className="product-dialog" labelledBy="product-dialog-title">
      <div className="dialog-surface product-dialog-surface">
        <button ref={closeRef} className="icon-button dialog-close" type="button" onClick={closeQuickView}>
          <Icon name="fa-solid fa-xmark" />
          <SrOnly>Close product details</SrOnly>
        </button>
        <div className="product-dialog-gallery">
          <div className="product-dialog-media">
            <img
              ref={imageRef}
              src={images[current] ?? BLANK}
              alt={product && variant ? `${product.name}, ${variant.name}, image ${current + 1} of ${images.length}` : ""}
              width={800}
              height={800}
            />
            <button className="gallery-arrow gallery-prev" type="button" hidden={images.length < 2} onClick={() => step(-1)}>
              <Icon name="fa-solid fa-arrow-left" />
              <SrOnly>Previous image</SrOnly>
            </button>
            <button className="gallery-arrow gallery-next" type="button" hidden={images.length < 2} onClick={() => step(1)}>
              <Icon name="fa-solid fa-arrow-right" />
              <SrOnly>Next image</SrOnly>
            </button>
            <span className="gallery-count" hidden={images.length < 2}>
              {current + 1} / {images.length}
            </span>
          </div>
          <div className="product-dialog-thumbs" hidden={images.length < 2}>
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
            <p className="product-dialog-category">{getCategory(product).name}</p>
            <h2 id="product-dialog-title">{product.name}</h2>
            <p className="product-dialog-price">{formatPrice(product.price)}</p>
            <p className="product-dialog-summary">{product.summary}</p>

            <fieldset className="variant-picker">
              <legend>
                Color: <span>{variant.name}</span>
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
              <Quantity value={quantity} max={MAX_QTY} onChange={(next) => setQuantity(Math.min(MAX_QTY, Math.max(1, next)))} />
              <button
                className="button purchase-add"
                type="button"
                onClick={() => {
                  addToBag(product.id, variantIndex, quantity);
                  setFeedback({ message: `${pluralize(quantity, "item")} added · ${variant.name}`, bagAction: true });
                }}
              >
                <Icon name="fa-solid fa-bag-shopping" />
                <span>Add to bag · {formatPrice(product.price * quantity)}</span>
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
              <a className="button button-outline" href={whatsappUrl(singleOrderMessage(product, variant, quantity))} target="_blank" rel="noopener">
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
                    message: copied ? "Order copied. Paste it into Messenger." : "Messenger opened. Tell us the piece and colour you want.",
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
                {(product.details ?? []).map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
              {product.note ? <p className="product-note">{product.note}</p> : null}
            </div>
          </div>
        ) : (
          <div className="product-dialog-info">
            <h2 id="product-dialog-title">Product details</h2>
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
