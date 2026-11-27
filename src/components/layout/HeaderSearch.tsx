import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ProductCard } from "@/domain/catalog-snapshot";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { listProductsFn } from "@/server/functions/catalog.functions";
import { PriceTag } from "@/components/store/PriceTag";
import { Icon } from "@/components/ui/primitives";

const MAX_DROPDOWN_RESULTS = 6;

export function HeaderSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [results, setResults] = useState<{ products: ProductCard[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const debounced = useDebouncedValue(text.trim(), 200);

  useEffect(() => {
    if (open) {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setText("");
      setResults(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // The header's search buttons toggle the bar themselves; closing here would make their click reopen it.
      if (target?.closest?.(".header-search, .header-search-mobile")) return;
      if (target && wrapRef.current && !wrapRef.current.contains(target)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !debounced) {
      setResults(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void listProductsFn({ data: { q: debounced } })
      .then((page) => {
        if (!cancelled) setResults({ products: page.products.slice(0, MAX_DROPDOWN_RESULTS), total: page.total });
      })
      .catch(() => {
        if (!cancelled) setResults({ products: [], total: 0 });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, debounced]);

  if (!open) return null;

  const trimmed = text.trim();

  return (
    <div className="header-search-bar" ref={wrapRef} role="search" aria-label="Search products">
      <div className="container-wide header-search-inner">
        <form
          className="header-search-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed) return;
            onClose();
            void navigate({ to: "/products", search: { q: trimmed } });
          }}
        >
          <Icon name="fa-solid fa-magnifying-glass" />
          <input
            ref={inputRef}
            // The bar mounts when it opens, so focus lands in the field on the same frame.
            autoFocus
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search cups, bowls, vases…"
            aria-label="Search products"
            maxLength={80}
          />
          <button type="button" className="icon-button" aria-label="Close search" onClick={onClose}>
            <Icon name="fa-solid fa-xmark" />
          </button>
        </form>

        {trimmed ? (
          <div className="header-search-dropdown" aria-live="polite">
            {loading && !results ? (
              <p className="header-search-status">Searching…</p>
            ) : results && results.products.length > 0 ? (
              <>
                <ul className="header-search-results">
                  {results.products.map((product) => (
                    <li key={product.id}>
                      <Link
                        to="/products/$slug"
                        params={{ slug: product.slug }}
                        className="header-search-item"
                        onClick={onClose}
                      >
                        <img src={product.images[0]} alt="" width={48} height={48} loading="lazy" />
                        <span className="header-search-name">{product.name}</span>
                        <span className="header-search-price">
                          <PriceTag price={product.price} regularPrice={product.regularPrice} sale={product.sale} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {results.total > results.products.length ? (
                  <Link to="/products" search={{ q: trimmed }} className="header-search-all" onClick={onClose}>
                    View all {results.total} results
                  </Link>
                ) : null}
              </>
            ) : results ? (
              <p className="header-search-status">No products matching &ldquo;{trimmed}&rdquo;.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
