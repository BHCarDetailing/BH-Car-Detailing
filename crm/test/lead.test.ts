import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, one } from "../src/lib/db";

const ORIGIN = "http://localhost:4173";

function leadBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    name: "JORGE ZURITA",
    phone: "(917) 555-0100",
    email: "  Jorge@Example.COM ",
    vehicle: "SUV / Truck",
    message: "Need a full detail",
    source: "hero-quote",
    source_detail: "/index.html",
    ts: Date.now() - 5000,
    website: "",
    ...overrides,
  });
}

const post = (body: string) =>
  SELF.fetch("http://x/api/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body,
  });

describe("POST /api/lead", () => {
  it("stores a normalized contact + vehicle + activity", async () => {
    const res = await post(leadBody());
    expect(res.status).toBe(200);
    const contact = await one<Record<string, unknown>>(
      env.DB, "SELECT * FROM contacts WHERE email = ?", "jorge@example.com");
    expect(contact).not.toBeNull();
    expect(contact!.first_name).toBe("Jorge");
    expect(contact!.last_name).toBe("Zurita");
    expect(contact!.phone).toBe("+19175550100");
    expect(contact!.stage).toBe("new");
    expect(contact!.email_opt_in).toBe(1);
    const vehicles = await all(env.DB, "SELECT * FROM vehicles WHERE contact_id = ?", contact!.id);
    expect(vehicles.length).toBe(1);
    expect((vehicles[0] as { size_class: string }).size_class).toBe("suv");
    const acts = await all(env.DB, "SELECT * FROM activities WHERE contact_id = ?", contact!.id);
    expect(acts.some((a) => (a as { type: string }).type === "form_submitted")).toBe(true);
  });

  it("dedupes on email and fills blanks without overwriting", async () => {
    await post(leadBody({ email: "dupe@example.com", phone: "" , name: "Ana"}));
    await post(leadBody({ email: "dupe@example.com", phone: "(305) 555-0101", name: "Ana Maria Lopez" }));
    const rows = await all(env.DB, "SELECT * FROM contacts WHERE email = ?", "dupe@example.com");
    expect(rows.length).toBe(1);
    const c = rows[0] as { first_name: string; phone: string };
    expect(c.first_name).toBe("Ana"); // not overwritten
    expect(c.phone).toBe("+13055550101"); // blank filled
  });

  it("honeypot pretends success and stores nothing", async () => {
    const res = await post(leadBody({ email: "bot@example.com", website: "http://spam.example" }));
    expect(res.status).toBe(200);
    expect(await one(env.DB, "SELECT id FROM contacts WHERE email = ?", "bot@example.com")).toBeNull();
  });

  it("too-fast submission (ts < 2s ago) stores nothing", async () => {
    await post(leadBody({ email: "fast@example.com", ts: Date.now() }));
    expect(await one(env.DB, "SELECT id FROM contacts WHERE email = ?", "fast@example.com")).toBeNull();
  });

  it("missing ts stores nothing", async () => {
    await post(leadBody({ email: "nots@example.com", ts: undefined }));
    expect(await one(env.DB, "SELECT id FROM contacts WHERE email = ?", "nots@example.com")).toBeNull();
  });

  it("requires email or phone", async () => {
    const res = await post(leadBody({ email: "", phone: "" }));
    expect(res.status).toBe(400);
  });

  it("derives area_slug from area pages", async () => {
    await post(leadBody({ email: "brickell@example.com", source: "area:brickell", source_detail: "/areas/brickell.html" }));
    const c = await one<{ area_slug: string }>(
      env.DB, "SELECT area_slug FROM contacts WHERE email = ?", "brickell@example.com");
    expect(c?.area_slug).toBe("brickell");
  });

  it("answers CORS preflight for the allowed origin", async () => {
    const res = await SELF.fetch("http://x/api/lead", {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });
});
