import { formatPrice } from "@/domain/catalog";

/**
 * A price, with the struck-through price beside it while a sale applies (P9.2). `price` is already the charged price
 * (the server applies the sale), and `regularPrice` the higher of the pre-sale and the manual regular price. Without a
 * sale only the price shows: a manual regular price alone is not struck through, as before.
 */
export function PriceTag({
  price,
  regularPrice,
  sale,
}: {
  price: number;
  regularPrice: number | null;
  sale: { badge: string } | null | undefined;
}) {
  if (!sale || regularPrice === null || regularPrice <= price) return <>{formatPrice(price)}</>;
  return (
    <span className="price-sale">
      <span className="sr-only">Sale price </span>
      <span className="price-now">{formatPrice(price)}</span>
      <s className="price-was">
        <span className="sr-only">, was </span>
        {formatPrice(regularPrice)}
      </s>
    </span>
  );
}
