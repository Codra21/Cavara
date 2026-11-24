import { Link } from "@tanstack/react-router";
import { availabilityTag } from "@/domain/bag";
import { cardImage, cardVariant, type ProductCard as Card } from "@/domain/catalog-snapshot";
import { pluralize } from "@/domain/catalog";
import { useStore } from "@/components/store/StoreProvider";
import { useOpenProduct } from "@/components/store/useOpenProduct";
import { PriceTag } from "@/components/store/PriceTag";
import { Swatch } from "@/components/ui/primitives";

/**
 * A grid card built from the summary snapshot's card shape (listing pages and home rows). A colour has one picture
 * there, so the hover picture exists only for the default colour, which carries two. The picture and the name both
 * open the product page; buying happens there.
 */
export function ProductCard({ product, categoryName, index }: { product: Card; categoryName: string; index: number }) {
  const { selectedVariant, selectVariant } = useStore();
  const openProduct = useOpenProduct();
  const selected = selectedVariant(product.id);
  const variant = cardVariant(product, selected);
  const visible = product.variants.slice(0, 5);
  const hiddenCount = product.variants.length - visible.length;
  const image = cardImage(product, selected);
  const altImage = selected === 0 ? product.images[1] : undefined;
  const stockTag = availabilityTag(variant.availability);

  return (
    <li
      className="product-card"
      data-reveal=""
      style={{ "--reveal-delay": `${(index % 4) * 80}ms` } as React.CSSProperties}
    >
      <div className="product-media">
        {/* Real links so crawlers find every product page; the name link below is the focusable one. */}
        <Link
          className="product-media-button"
          to="/products/$slug"
          params={{ slug: product.slug }}
          tabIndex={-1}
          aria-hidden="true"
        >
          <img
            className="product-image"
            src={image}
            alt={`${product.name}, ${variant.name}`}
            loading="lazy"
            decoding="async"
            width={800}
            height={1000}
          />
          {altImage ? (
            <img
              className="product-image-alt"
              src={altImage}
              alt=""
              loading="lazy"
              decoding="async"
              width={800}
              height={1000}
            />
          ) : null}
        </Link>
        {stockTag ? (
          <span className="product-badge is-sold-out">{stockTag}</span>
        ) : product.sale ? (
          <span className="product-badge is-sale">{product.sale.badge}</span>
        ) : product.variants.length > 1 ? (
          <span className="product-badge">{pluralize(product.variants.length, "colour")}</span>
        ) : null}
      </div>
      <div className="product-info">
        <p className="product-meta">{categoryName}</p>
        <h3 className="product-name">
          <Link to="/products/$slug" params={{ slug: product.slug }}>
            {product.name}
          </Link>
        </h3>
        <p className="product-price">
          <PriceTag price={product.price} regularPrice={product.regularPrice} sale={product.sale} />
        </p>
        <div className="product-swatches" role="group" aria-label={`${product.name} colours`}>
          {visible.map((item, itemIndex) => (
            <Swatch
              key={item.name}
              variant={item}
              selected={itemIndex === selected}
              onSelect={() => selectVariant(product.id, itemIndex)}
            />
          ))}
          {hiddenCount > 0 ? (
            <button
              className="swatch-more"
              type="button"
              aria-label={`View all ${product.variants.length} colours`}
              onClick={() => openProduct(product)}
            >
              +{hiddenCount}
            </button>
          ) : null}
        </div>
        <p className="product-variant-name">{variant.name}</p>
      </div>
    </li>
  );
}
