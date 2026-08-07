import { Hono } from "hono";
import type { Env } from "../types";
import { requireAuth } from "../lib/auth";
import { uuid } from "../lib/db";

/**
 * Media storage (R2) for content-calendar uploads. Dormant if the MEDIA
 * bucket binding is absent — upload returns 503 and the UI degrades to a
 * link-only content item. Keys are opaque single-segment (uuid + ext).
 */
export const mediaRoutes = new Hono<{ Bindings: Env }>();
mediaRoutes.use("*", requireAuth());

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const EXT_OK = /\.(png|jpe?g|gif|webp|mp4|mov|pdf)$/i;

mediaRoutes.post("/", async (c) => {
  if (!c.env.MEDIA) return c.json({ error: "media_not_configured" }, 503);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file") as unknown as
    { name?: unknown; size?: unknown; type?: unknown; arrayBuffer?: () => Promise<ArrayBuffer> } | null;
  if (!file || typeof file.arrayBuffer !== "function" || typeof file.name !== "string") {
    return c.json({ error: "file_required" }, 400);
  }
  if (typeof file.size === "number" && file.size > MAX_BYTES) return c.json({ error: "file_too_large" }, 413);
  const m = file.name.match(EXT_OK);
  if (!m) return c.json({ error: "unsupported_type" }, 415);
  const key = `${uuid()}${m[0].toLowerCase()}`;
  await c.env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: typeof file.type === "string" && file.type ? file.type : "application/octet-stream" },
  });
  return c.json({ key, url: `/api/media/${key}` }, 201);
});

mediaRoutes.get("/:key", async (c) => {
  if (!c.env.MEDIA) return c.json({ error: "media_not_configured" }, 503);
  const obj = await c.env.MEDIA.get(c.req.param("key"));
  if (!obj) return c.json({ error: "not_found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(obj.body, { headers });
});
