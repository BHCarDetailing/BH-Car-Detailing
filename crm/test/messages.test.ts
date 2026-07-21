import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

async function makeContact(first: string, phone: string) {
  const r = await SELF.fetch("http://x/api/contacts", {
    method: "POST", headers: AUTH, body: JSON.stringify({ first_name: first, phone }),
  });
  return ((await r.json()) as { id: string }).id;
}

describe("messages / SMS", () => {
  it("sends (logs) to a contact, threads it, and advances new -> contacted", async () => {
    const cid = await makeContact("Sms", "+13055551234");
    const send = await SELF.fetch("http://x/api/messages", {
      method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid, body: "Quote is $750" }),
    });
    expect(send.status).toBe(200);
    expect(((await send.json()) as { status: string }).status).toBe("logged");

    const thread = (await (await SELF.fetch(`http://x/api/messages?contact_id=${cid}`, { headers: AUTH })).json()) as { items: Array<{ body_text: string; direction: string }> };
    expect(thread.items.some((m) => m.body_text === "Quote is $750" && m.direction === "outbound")).toBe(true);

    const contact = (await (await SELF.fetch(`http://x/api/contacts/${cid}`, { headers: AUTH })).json()) as { stage: string };
    expect(contact.stage).toBe("contacted");

    const inbox = (await (await SELF.fetch("http://x/api/messages/inbox", { headers: AUTH })).json()) as { items: Array<{ contact_id: string }> };
    expect(inbox.items.some((m) => m.contact_id === cid)).toBe(true);
  });

  it("rejects sending without a phone on file", async () => {
    const r = await SELF.fetch("http://x/api/contacts", { method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "NoPhone", email: "np@x.com" }) });
    const cid = ((await r.json()) as { id: string }).id;
    const send = await SELF.fetch("http://x/api/messages", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid, body: "hi" }) });
    expect(send.status).toBe(400);
  });

  it("bridge /touch logs an activity and advances stage", async () => {
    const cid = await makeContact("Bridge", "+13055559999");
    const t = await SELF.fetch(`http://x/api/contacts/${cid}/touch`, { method: "POST", headers: AUTH, body: JSON.stringify({ channel: "sms" }) });
    expect(t.status).toBe(200);
    const acts = (await (await SELF.fetch(`http://x/api/contacts/${cid}/activities`, { headers: AUTH })).json()) as { items: Array<{ type: string }> };
    expect(acts.items.some((a) => a.type === "sms_logged")).toBe(true);
    const contact = (await (await SELF.fetch(`http://x/api/contacts/${cid}`, { headers: AUTH })).json()) as { stage: string };
    expect(contact.stage).toBe("contacted");
  });

  it("inbound webhook rejects a request with no/invalid Twilio signature (fail closed)", async () => {
    const form = new URLSearchParams({ From: "+13055550000", To: "+17866049110", Body: "hi", MessageSid: "SM1" });
    const res = await SELF.fetch("http://x/api/twilio/inbound", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(),
    });
    expect(res.status).toBe(403);
  });

  it("requires auth on the thread endpoint", async () => {
    expect((await SELF.fetch("http://x/api/messages?contact_id=x")).status).toBe(401);
  });
});
