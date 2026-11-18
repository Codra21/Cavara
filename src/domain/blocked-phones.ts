// Blocked phone numbers (P10.5). Pure: shared by the server functions and the admin UI.
import { z } from "zod";
import { normalizePhone } from "./orders";

export const MAX_BLOCK_REASON = 200;

/** A phone in the form orders store it (01XXXXXXXXX). Any accepted spelling is normalised, anything else is refused. */
const phoneField = z
  .string()
  .max(30)
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "Enter a Bangladeshi mobile number" });
      return z.NEVER;
    }
    return phone;
  });

export const blockPhoneSchema = z.object({
  phone: phoneField,
  reason: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(z.string().max(MAX_BLOCK_REASON))
    .default(""),
  /** The order the Owner blocked from; recorded in the audit row only. */
  orderId: z.uuid().optional(),
});
export type BlockPhoneInput = z.infer<typeof blockPhoneSchema>;

export const unblockPhoneSchema = z.object({ phone: phoneField });
export const phoneBlockedSchema = z.object({ phone: phoneField });

export interface BlockedPhone {
  phone: string;
  reason: string;
  createdAt: string;
  createdBy: string;
}
