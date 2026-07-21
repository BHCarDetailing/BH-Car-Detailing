import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { renderBookingConfirmation, sendEmail } from "../src/lib/email";
import { one } from "../src/lib/db";

describe("email fallback", () => {
  it("logs instead of sending when RESEND_API_KEY is unset", async () => {
    const res = await sendEmail(env, { kind: "transactional", toEmail: "x@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" });
    expect(res.status).toBe("logged");
    const row = await one<{ status: string; to_email: string }>(env.DB, "SELECT status, to_email FROM messages WHERE id = ?", res.id);
    expect(row?.status).toBe("logged");
    expect(row?.to_email).toBe("x@example.com");
  });

  it("renders a booking confirmation with the job details", () => {
    const out = renderBookingConfirmation(
      { title: "Ceramic coating", scheduled_start: "2026-08-01T14:00:00.000Z", address: "123 Ocean Dr", price_cents: 75000 },
      { first_name: "Jorge", last_name: "Zurita" }
    );
    expect(out.subject).toContain("Ceramic coating");
    expect(out.text).toContain("Jorge");
    expect(out.html).toContain("123 Ocean Dr");
  });
});
