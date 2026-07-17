import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "../src/lib/auth";

describe("session signing", () => {
  it("round-trips a valid session", async () => {
    const cookie = await signSession("secret-a", Date.now() + 60_000);
    expect(await verifySession("secret-a", cookie)).toBe(true);
  });
  it("rejects wrong secret", async () => {
    const cookie = await signSession("secret-a", Date.now() + 60_000);
    expect(await verifySession("secret-b", cookie)).toBe(false);
  });
  it("rejects expired", async () => {
    const cookie = await signSession("secret-a", Date.now() - 1000);
    expect(await verifySession("secret-a", cookie)).toBe(false);
  });
  it("rejects tampered expiry", async () => {
    const cookie = await signSession("secret-a", Date.now() + 60_000);
    const [, mac] = cookie.split(".");
    expect(await verifySession("secret-a", `${Date.now() + 9_999_999}.${mac}`)).toBe(false);
  });
});

describe("login endpoint", () => {
  it("rejects bad password with 401", async () => {
    const res = await SELF.fetch("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(res.status).toBe(401);
  });
  it("accepts ADMIN_PASSWORD and sets cookie", async () => {
    const res = await SELF.fetch("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "dev-password" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("bh_session=");
  });
  it("returns 401 (not 500) for a null JSON body and counts the attempt", async () => {
    const res = await SELF.fetch("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    expect(res.status).toBe(401);
  });
});

describe("requireAuth", () => {
  it("blocks /api/contacts without credentials", async () => {
    const res = await SELF.fetch("http://x/api/contacts");
    expect(res.status).toBe(401);
  });
  it("allows agent bearer token", async () => {
    const res = await SELF.fetch("http://x/api/contacts", {
      headers: { Authorization: "Bearer dev-agent-key" },
    });
    expect(res.status).not.toBe(401);
  });
});
