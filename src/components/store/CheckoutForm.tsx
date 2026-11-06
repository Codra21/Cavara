import { useId, useRef, useState } from "react";
import { formatPrice, getVariant } from "@/domain/catalog";
import { type CheckoutField, type CheckoutRequest, normalizePhone, type SubmitOrderResult } from "@/domain/orders";
import { WHATSAPP_DISPLAY } from "@/lib/config";
import { useCatalog } from "@/lib/query";
import type { BagItem } from "@/lib/types";
import { submitOrderFn } from "@/server/functions/orders.functions";

export interface PlacedOrder {
  reference: string;
  total: number;
  phone: string;
}

interface Draft {
  name: string;
  phone: string;
  zoneId: string;
  address: string;
  note: string;
}

const priceKey = (productId: number, variant: number) => `${productId}:${variant}`;

/**
 * Guest checkout inside the bag drawer. The server re-checks every price; when they changed, the form shows the
 * current ones and uses them for the next send.
 */
export function CheckoutForm({
  bag,
  onBack,
  onPlaced,
}: {
  bag: BagItem[];
  onBack: () => void;
  onPlaced: (order: PlacedOrder) => void;
}) {
  const id = useId();
  const catalog = useCatalog();
  const zones = catalog.deliveryZones;
  const [draft, setDraft] = useState<Draft>({
    name: "",
    phone: "",
    zoneId: zones[0]?.id ?? "",
    address: "",
    note: "",
  });
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Partial<Record<CheckoutField, string>>>({});
  const [message, setMessage] = useState<{ tone: "error" | "notice"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  /** Prices the server reported after a price change, used until the bag or the catalogue catches up. */
  const [serverPrices, setServerPrices] = useState<Map<string, number>>(new Map());
  const [serverCharge, setServerCharge] = useState<{ zoneId: string; charge: number } | null>(null);
  /** The key is reused only for an identical retry, so a lost response cannot create a second order. */
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const errorSummary = useRef<HTMLDivElement>(null);

  const lines = bag.flatMap((item) => {
    const product = catalog.productById.get(item.id);
    if (!product) return [];
    const unitPrice = serverPrices.get(priceKey(item.id, item.variant)) ?? product.price;
    return [{ item, product, variant: getVariant(product, item.variant), unitPrice }];
  });
  const zone = zones.find((candidate) => candidate.id === draft.zoneId);
  const deliveryCharge =
    serverCharge && serverCharge.zoneId === draft.zoneId ? serverCharge.charge : (zone?.charge ?? 0);
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.item.qty, 0);
  const total = subtotal + deliveryCharge;

  const update = (field: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value;
    setDraft((previous) => ({ ...previous, [field]: value }));
    if (errors[field as CheckoutField]) setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setMessage(null);
    const body: Omit<CheckoutRequest, "idempotencyKey"> = {
      ...draft,
      deliveryCharge,
      items: lines.map((line) => ({
        productId: line.item.id,
        variant: line.item.variant,
        qty: line.item.qty,
        unitPrice: line.unitPrice,
      })),
      website,
    };
    const payload = JSON.stringify(body);
    if (attempt.current?.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };

    setPending(true);
    let result: SubmitOrderResult;
    try {
      result = await submitOrderFn({ data: { ...body, idempotencyKey: attempt.current.key } });
    } catch {
      result = {
        ok: false,
        code: "failed",
        message: "We couldn't reach the shop. Check your connection and send the order again.",
      };
    }
    setPending(false);

    if (result.ok) {
      onPlaced({ reference: result.reference, total: result.total, phone: normalizePhone(draft.phone) ?? draft.phone });
      return;
    }
    if (result.code === "validation") {
      setErrors(result.fieldErrors);
      const first = Object.keys(result.fieldErrors)[0];
      if (first && first !== "items") document.getElementById(`${id}-${first}`)?.focus();
    } else if (result.code === "price_changed") {
      setServerPrices(
        new Map(result.prices.map((price) => [priceKey(price.productId, price.variant), price.unitPrice])),
      );
      setServerCharge({ zoneId: draft.zoneId, charge: result.deliveryCharge });
    }
    setMessage({ tone: result.code === "price_changed" ? "notice" : "error", text: result.message });
    window.requestAnimationFrame(() => errorSummary.current?.focus());
  }

  const fieldProps = (field: CheckoutField) => ({
    id: `${id}-${field}`,
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${id}-${field}-error` : undefined,
  });
  const fieldError = (field: CheckoutField) =>
    errors[field] ? (
      <p className="checkout-error" id={`${id}-${field}-error`}>
        {errors[field]}
      </p>
    ) : null;

  return (
    <form className="checkout" onSubmit={submit} noValidate aria-labelledby={`${id}-title`}>
      <div className="checkout-head">
        <button className="text-button checkout-back" type="button" onClick={onBack}>
          ← Back to bag
        </button>
        <h3 id={`${id}-title`}>Delivery details</h3>
        <p>We call you to confirm the order. Pay cash on delivery or by mobile banking.</p>
      </div>

      <div ref={errorSummary} tabIndex={-1} aria-live="polite" className="checkout-message-slot">
        {message ? <p className={`checkout-message is-${message.tone}`}>{message.text}</p> : null}
        {errors.items ? <p className="checkout-message is-error">{errors.items}</p> : null}
      </div>

      <div className="checkout-field">
        <label htmlFor={`${id}-name`}>Full name</label>
        <input
          {...fieldProps("name")}
          name="name"
          autoComplete="name"
          maxLength={80}
          value={draft.name}
          onChange={update("name")}
          required
        />
        {fieldError("name")}
      </div>

      <div className="checkout-field">
        <label htmlFor={`${id}-phone`}>Mobile number</label>
        <input
          {...fieldProps("phone")}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="01XXX-XXXXXX"
          maxLength={20}
          value={draft.phone}
          onChange={update("phone")}
          required
        />
        {fieldError("phone")}
      </div>

      <fieldset className="checkout-zones" aria-describedby={errors.zoneId ? `${id}-zoneId-error` : undefined}>
        <legend>Delivery area</legend>
        {zones.map((option, index) => (
          <label className="checkout-zone" key={option.id}>
            <input
              id={index === 0 ? `${id}-zoneId` : undefined}
              type="radio"
              name="zoneId"
              value={option.id}
              checked={draft.zoneId === option.id}
              onChange={() => {
                setDraft((previous) => ({ ...previous, zoneId: option.id }));
                setErrors((previous) => ({ ...previous, zoneId: undefined }));
              }}
            />
            <span>{option.name}</span>
            <strong>{formatPrice(option.id === serverCharge?.zoneId ? serverCharge.charge : option.charge)}</strong>
          </label>
        ))}
        {fieldError("zoneId")}
      </fieldset>

      <div className="checkout-field">
        <label htmlFor={`${id}-address`}>Full address</label>
        <textarea
          {...fieldProps("address")}
          name="address"
          autoComplete="street-address"
          rows={3}
          maxLength={300}
          placeholder="House, road, area, thana, district"
          value={draft.address}
          onChange={update("address")}
          required
        />
        {fieldError("address")}
      </div>

      <div className="checkout-field">
        <label htmlFor={`${id}-note`}>
          Note <span className="checkout-optional">(optional)</span>
        </label>
        <textarea
          {...fieldProps("note")}
          name="note"
          rows={2}
          maxLength={300}
          placeholder="Best time to call, gift message…"
          value={draft.note}
          onChange={update("note")}
        />
        {fieldError("note")}
      </div>

      {/* Honeypot: hidden from people and screen readers; bots that fill every field are rejected. */}
      <div className="checkout-trap" aria-hidden="true">
        <label htmlFor={`${id}-website`}>Website</label>
        <input
          id={`${id}-website`}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      <dl className="checkout-summary">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatPrice(subtotal)}</dd>
        </div>
        <div>
          <dt>Delivery{zone ? ` (${zone.name})` : ""}</dt>
          <dd>{formatPrice(deliveryCharge)}</dd>
        </div>
        <div className="checkout-total">
          <dt>Total</dt>
          <dd>{formatPrice(total)}</dd>
        </div>
      </dl>

      <button className="button checkout-submit" type="submit" disabled={pending || lines.length === 0}>
        {pending ? "Placing order…" : `Place order · ${formatPrice(total)}`}
      </button>
      <p className="checkout-help">Questions? WhatsApp us at {WHATSAPP_DISPLAY}. No payment is taken online.</p>
    </form>
  );
}
