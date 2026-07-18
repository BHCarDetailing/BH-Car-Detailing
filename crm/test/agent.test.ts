import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("agent schema", () => {
  it("requires auth", async () => {
    expect((await SELF.fetch("http://x/api/agent/schema")).status).toBe(401);
  });
  it("describes the API", async () => {
    const res = await SELF.fetch("http://x/api/agent/schema", {
      headers: { Authorization: "Bearer dev-agent-key" },
    });
    expect(res.status).toBe(200);
    const s = (await res.json()) as { endpoints: Array<{ method: string; path: string }> };
    const paths = s.endpoints.map((e) => `${e.method} ${e.path}`);
    expect(paths).toContain("POST /api/lead");
    expect(paths).toContain("GET /api/contacts");
    expect(paths).toContain("POST /api/contacts/bulk");
    expect(paths).toContain("GET /api/stats");
  });
});
