import { useId, useRef, useState } from "react";
import { type CouponAnswer, normalizeCouponCode } from "@/domain/coupons";
import type { BuyableLine } from "@/domain/bag";
import { formatPrice } from "@/domain/catalog";
import {
  type CheckoutField,
  type CheckoutRequest,
  type DeliveryZone,
  normalizePhone,
  type SubmitOrderResult,
} from "@/domain/orders";
import { WHATSAPP_DISPLAY } from "@/lib/config";
import { getTurnstileToken } from "@/lib/turnstile";
import { checkCouponFn } from "@/server/functions/coupons.functions";
import { submitOrderFn } from "@/server/functions/orders.functions";

export interface PlacedOrder {
  reference: string;
  total: number;
  phone: string;
}

export interface CheckoutDraft {
  name: string;
  phone: string;
  zoneId: string;
  address: string;
  note: string;
}

export const EMPTY_DRAFT: CheckoutDraft = {
  name: "",
  phone: "",
  zoneId: "",
  address: "",
  note: "",
};

const priceKey = (productId: number, variant: number) => `${productId}:${variant}`;

/**
 * Guest checkout inside the bag drawer. `lines` are the buyable bag lines and `zones` the delivery areas, both from
 * the drawer's getProductsByIdsFn lookup. The server re-checks every price; when they changed, the form shows the
 * current ones and uses them for the next send.
 */
export function CheckoutForm({
  lines: buyable,
  zones,
  draft,
  onDraftChange: setDraft,
  onBack,
  onPlaced,
}: {
  lines: BuyableLine[];
  zones: DeliveryZone[];
  draft: CheckoutDraft;
  onDraftChange: React.Dispatch<React.SetStateAction<CheckoutDraft>>;
  onBack: () => void;
  onPlaced: (order: PlacedOrder) => void;
}) {
  const id = useId();
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Partial<Record<CheckoutField, string>>>({});
  const [message, setMessage] = useState<{ tone: "error" | "notice"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  /** Prices the server reported after a price change, used until the bag lookup catches up. */
  const [serverPrices, setServerPrices] = useState<Map<string, number>>(new Map());
  const [serverCharge, setServerCharge] = useState<{ zoneId: string; charge: number } | null>(null);
  /** The applied coupon and the discount the server last confirmed; the server checks both again on send. */
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponText, setCouponText] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponPending, setCouponPending] = useState(false);
  const couponPendingRef = useRef(false);
  /** The key is reused only for an identical retry, so a lost response cannot create a second order. */
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  /** Where the Turnstile widget appears if Cloudflare wants the shopper to tick it (hidden otherwise). */
  const orderCheck = useRef<HTMLDivElement>(null);
  const couponCheck = useRef<HTMLDivElement>(null);

  const lines = buyable.map((line) => ({
    ...line,
    unitPrice: serverPrices.get(priceKey(line.item.id, line.item.variant)) ?? line.product.price,
  }));
  const zone = zones.find((candidate) => candidate.id === draft.zoneId) ?? zones[0];
  const zoneId = zone?.id ?? "";
  const deliveryCharge = serverCharge && serverCharge.zoneId === zoneId ? serverCharge.charge : (zone?.charge ?? 0);
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.item.qty, 0);
  const couponDiscount = coupon?.discount ?? 0;
  const total = subtotal - couponDiscount + deliveryCharge;

  const applyAnswer = (answer: CouponAnswer) => {
    if (answer.ok) {
      setCoupon({ code: answer.code, discount: answer.discount });
      setCouponError(null);
      setCouponText("");
    } else {
      setCoupon(null);
      setCouponError(answer.message);
    }
  };

  async function applyCoupon() {
    if (couponPendingRef.current) return;
    const code = normalizeCouponCode(couponText);
    if (!code) {
      setCouponError(couponText.trim() ? "Codes are 3 to 20 letters, digits or hyphens." : "Enter your code.");
      return;
    }
    couponPendingRef.current = true;
    setCouponPending(true);
    setCouponError(null);
    try {
      // A fresh single-use token for every call; "" when the check is switched off for this build.
      let turnstileToken: string;
      try {
        turnstileToken = await getTurnstileToken("coupon", couponCheck.current);
      } catch {
        setCouponError("We couldn't run the security check. Reload the page and try again.");
        couponPendingRef.current = false;
        setCouponPending(false);
        return;
      }
      const answer = await checkCouponFn({
        data: {
          turnstileToken,
          code,
          items: lines.map((line) => ({ productId: line.item.id, variant: line.item.variant, qty: line.item.qty })),
        },
      });
      if (answer.ok) applyAnswer(answer);
      else setCouponError(answer.message);
    } catch {
      setCouponError("We couldn't reach the shop. Check your connection and try again.");
    }
    couponPendingRef.current = false;
    setCouponPending(false);
  }

  const update = (field: keyof CheckoutDraft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value;
    setDraft((previous) => ({ ...previous, [field]: value }));
    if (errors[field as CheckoutField]) setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pendingRef.current) return;
    setMessage(null);
    const body: Omit<CheckoutRequest, "idempotencyKey"> = {
      ...draft,
      zoneId,
      deliveryCharge,
      couponCode: coupon?.code ?? "",
      couponDiscount,
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

    pendingRef.current = true;
    setPending(true);
    let result: SubmitOrderResult;
    try {
      // Fetched after the idempotency key is fixed and kept out of the payload, so a retry of the same order gets a
      // new token and still replays the same key. A failed check is not a network error: say what happened.
      let turnstileToken: string;
      try {
        turnstileToken = await getTurnstileToken("order", orderCheck.current);
      } catch {
        pendingRef.current = false;
        setPending(false);
        setMessage({
          tone: "error",
          text: "We couldn't run the security check. Your bag is unchanged. Reload the page and try again, or message us on WhatsApp.",
        });
        window.requestAnimationFrame(() => errorSummary.current?.focus());
        return;
      }
      result = await submitOrderFn({ data: { ...body, idempotencyKey: attempt.current.key, turnstileToken } });
    } catch {
      result = {
        ok: false,
        code: "failed",
        message: "We couldn't reach the shop. Check your connection and send the order again.",
      };
    }
    pendingRef.current = false;
    setPending(false);

    if (result.ok) {
      onPlaced({ reference: result.reference, total: result.total, phone: normalizePhone(draft.phone) ?? draft.phone });
      return;
    }
    let focusField: string | undefined;
    if (result.code === "validation") {
      setErrors(result.fieldErrors);
      focusField = (["name", "phone", "zoneId", "address", "note"] as const).find((field) => result.fieldErrors[field]);
    } else if (result.code === "price_changed") {
      setServerPrices(
        new Map(result.prices.map((price) => [priceKey(price.productId, price.variant), price.unitPrice])),
      );
      setServerCharge({ zoneId, charge: result.deliveryCharge });
      // A coupon that changed or stopped applying: show its new discount, or drop it and say why next to the field.
      if (result.coupon) {
        applyAnswer(result.coupon);
        if (!result.coupon.ok) setCouponOpen(true);
      }
    }
    setMessage({ tone: result.code === "price_changed" ? "notice" : "error", text: result.message });
    window.requestAnimationFrame(() => {
      if (focusField) document.getElementById(`${id}-${focusField}`)?.focus();
      else errorSummary.current?.focus();
    });
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
          type="text"
          inputMode="text"
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
              checked={zoneId === option.id}
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

      <div className="checkout-coupon">
        {coupon ? (
          <div className="checkout-coupon-applied">
            <span>
              Code <strong>{coupon.code}</strong> applied
            </span>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setCoupon(null);
                setCouponError(null);
              }}
            >
              Remove<span className="sr-only"> code {coupon.code}</span>
            </button>
          </div>
        ) : (
          <details open={couponOpen} onToggle={(event) => setCouponOpen(event.currentTarget.open)}>
            <summary>Have a code?</summary>
            <div className="checkout-field">
              <label htmlFor={`${id}-coupon`}>Coupon code</label>
              <div className="checkout-coupon-row">
                <input
                  id={`${id}-coupon`}
                  className="checkout-coupon-input"
                  name="coupon"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={40}
                  placeholder="Enter code"
                  value={couponText}
                  aria-invalid={couponError ? true : undefined}
                  aria-describedby={couponError ? `${id}-coupon-error` : undefined}
                  onChange={(event) => {
                    setCouponText(event.target.value);
                    if (couponError) setCouponError(null);
                  }}
                  onKeyDown={(event) => {
                    // Enter applies the code; it must not place the order.
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void applyCoupon();
                    }
                  }}
                />
                <button
                  className="button button-outline"
                  type="button"
                  disabled={couponPending}
                  onClick={() => void applyCoupon()}
                >
                  {couponPending ? "Checking…" : "Apply"}
                </button>
              </div>
              <div className="checkout-check" ref={couponCheck}>
                <p>Tick the box to confirm you're a person, then the code applies.</p>
              </div>
              <div aria-live="polite">
                {couponError ? (
                  <p className="checkout-error" id={`${id}-coupon-error`}>
                    {couponError}
                  </p>
                ) : null}
              </div>
            </div>
          </details>
        )}
      </div>

      <dl className="checkout-summary">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatPrice(subtotal)}</dd>
        </div>
        {coupon ? (
          <div className="checkout-discount">
            <dt>Code {coupon.code}</dt>
            <dd>−{formatPrice(coupon.discount)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Delivery{zone ? ` (${zone.name})` : ""}</dt>
          <dd>{formatPrice(deliveryCharge)}</dd>
        </div>
        <div className="checkout-total">
          <dt>Total</dt>
          <dd>{formatPrice(total)}</dd>
        </div>
      </dl>

      <div className="checkout-actions">
        <div className="checkout-check" ref={orderCheck}>
          <p>Tick the box to confirm you're a person, then your order goes through.</p>
        </div>
        <button className="button checkout-submit" type="submit" disabled={pending || lines.length === 0}>
          {pending ? "Placing order…" : `Place order · ${formatPrice(total)}`}
        </button>
        <p className="checkout-help">Questions? WhatsApp us at {WHATSAPP_DISPLAY}. No payment is taken online.</p>
      </div>
    </form>
  );
}
