import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { AdminIdentity } from "@/domain/admin";
import { blockPhoneSchema } from "@/domain/blocked-phones";
import { listAudit } from "@/server/admin/auth.server";
import { blockPhone, phoneAuditId, unblockPhone } from "@/server/db/admin-blocked-phones.repository";
import { createTestD1 } from "./helpers/d1";

const owner: AdminIdentity = { id: "owner", username: "owner", role: "owner" };
const T0 = new Date("2026-11-07T04:00:00.000Z");
const PHONE = "01712345678";
const SECRET_A = "secret-key-alpha-32-chars-minimum";
const SECRET_B = "secret-key-bravo-32-chars-minimum";

describe("phoneAuditId (S2B-3 keyed HMAC regression)", () => {
  test("produces a keyed digest distinct from unkeyed SHA-256 and varying with the secret", () => {
    const unkeyedRaw = createHash("sha256").update(PHONE).digest("hex").slice(0, 12);
    const unkeyedPrefixed = createHash("sha256").update(`blocked:${PHONE}`).digest("hex").slice(0, 12);

    const idA1 = phoneAuditId(PHONE, SECRET_A);
    const idA2 = phoneAuditId(PHONE, SECRET_A);
    const idB = phoneAuditId(PHONE, SECRET_B);

    expect(idA1).toMatch(/^[0-9a-f]{12}$/);
    expect(idA1).toBe(idA2);
    expect(idA1).not.toBe(unkeyedRaw);
    expect(idA1).not.toBe(unkeyedPrefixed);
    expect(idA1).not.toBe(idB);
  });

  test("rejects an empty secret key", () => {
    expect(() => phoneAuditId(PHONE, "")).toThrow();
  });

  test("blockPhone and unblockPhone record the keyed phoneAuditId in admin_audit", async () => {
    const db = createTestD1();
    const unkeyedPrefixed = createHash("sha256").update(`blocked:${PHONE}`).digest("hex").slice(0, 12);

    await blockPhone(db, owner, blockPhoneSchema.parse({ phone: PHONE, reason: "test" }), SECRET_A, T0);
    await unblockPhone(db, owner, PHONE, SECRET_A, T0);

    const audit = await listAudit(db);
    expect(audit).toHaveLength(2);
    const expected = phoneAuditId(PHONE, SECRET_A);
    for (const row of audit) {
      expect(row.targetId).toBe(expected);
      expect(row.targetId).not.toBe(unkeyedPrefixed);
    }
  });
});
