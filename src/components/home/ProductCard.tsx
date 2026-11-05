import { useEffect, useState } from "react";
import { formatPrice, getCategory, getVariant, pluralize } from "@/domain/catalog";
import { useCatalog } from "@/lib/query";
import type { Product } from "@/lib/types";
import { useStore } from "@/components/store/StoreProvider";
import { useOpenProduct } from "@/components/store/useOpenProduct";
import { Icon, Swatch } from "@/components/ui/primitives";

export function ProductCard({ product, index }: { product: Product; index: number }) {
  const catalog = useCatalog();
  const { selectedVariant, selectVariant, addToBag, showToast, openBag, openQuickView } = useStore();
  const openProduct = useOpenProduct();
  const [added, setAdded] = useState(false);
  const selected = selectedVariant(product.id);
  const variant = getVariant(product, selected);
  const visible = product.variants.slice(0, 5);
  const hiddenCount = product.variants.length - visible.length;
  const altImage = variant.images[1];

  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(false), 1400);
    return () => window.clearTimeout(timer);
  }, [added]);

  return (
    <li className="product-card" data-reveal="" style={{ "--reveal-delay": `${(index % 4) * 80}ms` } as React.CSSProperties}>
      <div className="product-media">
        <button className="product-media-button" type="button" tabIndex={-1} aria-hidden="true" onClick={() => openProduct(product)}>
          <img className="product-image" src={variant.images[0]} alt={`${product.name}, ${variant.name}`} loading="lazy" decoding="async" width={800} height={1000} />
          {product.variants.some((item) => item.images[1]) ? (
            <img className="product-image-alt" src={altImage ?? variant.images[0]} hidden={!altImage} alt="" loading="lazy" decoding="async" width={800} height={1000} />
          ) : null}
        </button>
        {product.variants.length > 1 ? <span className="product-badge">{pluralize(product.variants.length, "colour")}</span> : null}
        <div className="product-icons">
          <button className="card-icon" type="button" tabIndex={-1} aria-hidden="true" title="View full details" onClick={() => openProduct(product)}>
            <Icon name="fa-solid fa-up-right-and-down-left-from-center" />
          </button>
        </div>
        <div className="product-actions">
          <button
            className={`quick-add${added ? " is-added" : ""}`}
            type="button"
            aria-label={`Add ${product.name}, ${variant.name}, to bag`}
            onClick={() => {
              addToBag(product.id, selected, 1);
              setAdded(true);
              showToast(`${product.name} added to your bag`, { actionLabel: "View bag", action: openBag });
            }}
          >
            <Icon name={`fa-solid ${added ? "fa-check" : "fa-bag-shopping"}`} />
            <span>{added ? "Added" : "Add to bag"}</span>
          </button>
          <button className="card-quick-view" type="button" aria-label={`Quick view ${product.name}`} onClick={() => openQuickView(product.id)}>
            <Icon name="fa-regular fa-eye" />
            <span>Quick view</span>
          </button>
        </div>
      </div>
      <div className="product-info">
        <p className="product-meta">{getCategory(catalog, product).name}</p>
        <h3 className="product-name">
          <button type="button" onClick={() => openProduct(product)}>
            {product.name}
          </button>
        </h3>
        <p className="product-price">{formatPrice(product.price)}</p>
        <div className="product-swatches" role="group" aria-label={`${product.name} colours`}>
          {visible.map((item, itemIndex) => (
            <Swatch key={item.name} variant={item} selected={itemIndex === selected} onSelect={() => selectVariant(product.id, itemIndex)} />
          ))}
          {hiddenCount > 0 ? (
            <button className="swatch-more" type="button" aria-label={`View all ${product.variants.length} colours`} onClick={() => openProduct(product)}>
              +{hiddenCount}
            </button>
          ) : null}
        </div>
        <p className="product-variant-name">{variant.name}</p>
      </div>
    </li>
  );
}
