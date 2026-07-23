import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

describe("unified inbox", () => {
  it("a webchat message shows up in the inbox and the thread", async () => {
    const phone = "3055551212";
    const res = await SELF.fetch("http://x/api/lead", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Web Chatter", phone, message: "do you do ceramic?", source: "webchat", website: "", ts: Date.now() - 5000 }),
    });
    expect(res.status).toBe(200);

    // Find the contact.
    const found = (await (await SELF.fetch(`http://x/api/contacts?search=${phone}`, { headers: AUTH })).json()) as { items: Array<{ id: string }> };
    const contactId = found.items[0].id;

    // Inbox includes them.
    const inbox = (await (await SELF.fetch("http://x/api/messages/inbox", { headers: AUTH })).json()) as { items: Array<{ contact_id: string; channel?: string; body_text: string | null }> };
    const row = inbox.items.find((r) => r.contact_id === contactId)!;
    expect(row).toBeTruthy();
    expect(row.body_text).toBe("do you do ceramic?");

    // Thread contains the inbound webchat message.
    const thread = (await (await SELF.fetch(`http://x/api/messages?contact_id=${contactId}`, { headers: AUTH })).json()) as { items: Array<{ channel: string; direction: string; body_text: string }> };
    const wc = thread.items.find((m) => m.channel === "webchat")!;
    expect(wc).toBeTruthy();
    expect(wc.direction).toBe("inbound");
    expect(wc.body_text).toBe("do you do ceramic?");
  });
});
