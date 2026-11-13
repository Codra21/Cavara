import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applySecurityHeaders,
  contentSecurityPolicyReportOnly,
  FRAME_ANCESTORS_POLICY,
  HSTS,
  imageOrigin,
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
} from "@/server/security-headers";
import { healthResponse } from "@/server/health";

const https = new Request("https://cavarabd.com/");
const http = new Request("http://localhost:3000/");
const page = () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=utf-8" } });

describe("applySecurityHeaders", () => {
  test("HTML over https gets the full set", () => {
    const res = applySecurityHeaders(page(), https, { imagesOrigin: "https://images.cavarabd.com" });
    expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    expect(res.headers.get("Strict-Transport-Security")).not.toContain("preload");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toBe(PERMISSIONS_POLICY);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toContain(
      "img-src 'self' data: https://images.cavarabd.com",
    );
  });

  test("the Permissions-Policy switches off features the shop never uses", () => {
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
      expect(PERMISSIONS_POLICY).toContain(`${feature}=()`);
    }
  });

  test("HSTS is only sent over https", () => {
    expect(applySecurityHeaders(page(), http).headers.has("Strict-Transport-Security")).toBe(false);
  });

  test("non-HTML responses skip the framing and CSP headers but keep the rest", () => {
    const json = applySecurityHeaders(new Response("{}", { headers: { "Content-Type": "application/json" } }), https);
    expect(json.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(json.headers.get("Strict-Transport-Security")).toBe(HSTS);
    expect(json.headers.has("Content-Security-Policy")).toBe(false);
    expect(json.headers.has("Content-Security-Policy-Report-Only")).toBe(false);
    expect(json.headers.has("X-Frame-Options")).toBe(false);
  });

  test("the admin's Cache-Control and other route headers survive", () => {
    const admin = new Response("<!doctype html>", {
      headers: { "Content-Type": "text/html", "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
    const res = applySecurityHeaders(admin, new Request("https://cavarabd.com/admin"));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Vary")).toBe("Cookie");
  });

  test("a header the route set itself is not replaced", () => {
    const custom = new Response("x", { headers: { "Content-Type": "text/html", "Referrer-Policy": "no-referrer" } });
    expect(applySecurityHeaders(custom, https).headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  test("a www redirect (immutable headers) keeps its status and Location and gains the headers", () => {
    const res = applySecurityHeaders(Response.redirect("https://cavarabd.com/products/x?a=1", 301), https);
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://cavarabd.com/products/x?a=1");
    expect(res.headers.get("Strict-Transport-Security")).toBe(HSTS);
  });

  test("status, status text and body pass through", async () => {
    const res = applySecurityHeaders(
      new Response("missing", { status: 404, statusText: "Not Found", headers: { "Content-Type": "text/html" } }),
      https,
    );
    expect(res.status).toBe(404);
    expect(res.statusText).toBe("Not Found");
    expect(await res.text()).toBe("missing");
  });
});

describe("content security policy (report-only)", () => {
  const policy = contentSecurityPolicyReportOnly("https://images.cavarabd.com");
  const directive = (name: string) => policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

  test("lists only the origins the site loads", () => {
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("img-src")).toBe("img-src 'self' data: https://images.cavarabd.com");
    expect(directive("font-src")).toBe("font-src 'self' https://cdnjs.cloudflare.com");
    expect(directive("style-src")).toContain("https://cdnjs.cloudflare.com");
    expect(directive("connect-src")).toBe("connect-src 'self'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("frame-ancestors")).toBe(FRAME_ANCESTORS_POLICY);
  });

  test("Google Fonts are gone: fonts are self-hosted", () => {
    expect(policy).not.toContain("googleapis");
    expect(policy).not.toContain("gstatic");
  });

  test("without a custom image domain, images come from the Worker only", () => {
    expect(contentSecurityPolicyReportOnly(null)).toContain("img-src 'self' data:;");
  });

  test("imageOrigin keeps the origin of an https base and ignores blank or non-https values", () => {
    expect(imageOrigin("https://images.cavarabd.com")).toBe("https://images.cavarabd.com");
    expect(imageOrigin("https://images.cavarabd.com/path")).toBe("https://images.cavarabd.com");
    expect(imageOrigin("")).toBeNull();
    expect(imageOrigin("http://images.example.com")).toBeNull();
  });
});

describe("public/_headers (static assets)", () => {
  const file = readFileSync(join(import.meta.dir, "../../public/_headers"), "utf8");

  test("repeats the Worker's values, so both paths send the same headers", () => {
    expect(file).toContain(`Strict-Transport-Security: ${HSTS}`);
    expect(file).toContain(`Referrer-Policy: ${REFERRER_POLICY}`);
    expect(file).toContain(`Permissions-Policy: ${PERMISSIONS_POLICY}`);
    expect(file).toContain(`Content-Security-Policy: ${FRAME_ANCESTORS_POLICY}`);
    expect(file).toContain("X-Content-Type-Options: nosniff");
    expect(file).toContain("X-Frame-Options: DENY");
  });

  test("stays inside Workers Assets limits (100 rules, 2,000 characters a line)", () => {
    const lines = file.split("\n");
    expect(lines.every((line) => line.length <= 2000)).toBe(true);
    expect(lines.filter((line) => line.startsWith("/")).length).toBeLessThanOrEqual(100);
  });
});

describe("healthResponse", () => {
  test("is a 200 that no cache may keep, with a tiny body", async () => {
    const res = healthResponse();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.text()).trim()).toBe("ok");
  });
});
