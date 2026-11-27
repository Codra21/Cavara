import { formatPrice } from "@/domain/catalog";

/**
 * A price, with the struck-through regular price and a "Save ৳N" badge whenever `regularPrice` is above `price`
 * (whether from a timed sale or a manual regular price).
 */
export function PriceTag({
  price,
  regularPrice,
  sale,
}: {
  price: number;
  regularPrice: number | null;
  sale?: { badge: string } | null | undefined;
}) {
  if (regularPrice === null || regularPrice <= price) {
    return <span className="price-value">{formatPrice(price)}</span>;
  }
  const saved = regularPrice - price;
  return (
    <span className="price-sale">
      <span className="sr-only">{sale ? "Sale price " : "Price "}</span>
      <span className="price-now">{formatPrice(price)}</span>
      <s className="price-was">
        <span className="sr-only">, was </span>
        {formatPrice(regularPrice)}
      </s>
      <span className="price-save">Save {formatPrice(saved)}</span>
    </span>
  );
}
