import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("health", () => {
  it("responds ok", async () => {
    const res = await SELF.fetch("http://x/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
