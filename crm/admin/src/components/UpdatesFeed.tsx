import { useMemo, useState } from "react";
import { Tag, Button, DeleteButton } from "./ui";
import { UPDATE_CATS, colorOf, labelOf, type Row } from "../lib/collections";

/* Shared update composer + timeline feed. Used on the Dashboard (compact) and
   the full Updates page. Backed by the `updates` collection. */

export interface UpdateRow extends Row {
  category: string;
  body: string;
  author: string | null;
  pinned: number;
  created_at: string;
}

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yst = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yst.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

export function UpdateComposer({ onPost, compact }: { onPost: (data: Record<string, unknown>) => Promise<unknown>; compact?: boolean }) {
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("general");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onPost({ body: text, category });
      setBody("");
      setCategory("general");
    } finally { setBusy(false); }
  }

  return (
    <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-100 ${compact ? "" : ""}`}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(); }}
        placeholder="Post an update… (meeting notes, a call, a car event, a win)"
        className="min-h-[64px] w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {UPDATE_CATS.map((cat) => (
            <button key={cat.value} onClick={() => setCategory(cat.value)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${
                category === cat.value ? "bg-red-600 text-white ring-red-600" : "bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50"
              }`}>
              {cat.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[11px] text-neutral-400 sm:inline">⌘↵ to post</span>
          <Button onClick={submit} disabled={busy || !body.trim()}>{busy ? "Posting…" : "Post update"}</Button>
        </div>
      </div>
    </div>
  );
}

export function UpdateFeed({ items, onDelete, onTogglePin, limit }: {
  items: UpdateRow[]; onDelete?: (id: string) => void; onTogglePin?: (u: UpdateRow) => void; limit?: number;
}) {
  const shown = limit ? items.slice(0, limit) : items;
  const groups = useMemo(() => {
    const map = new Map<string, UpdateRow[]>();
    for (const u of shown) {
      const k = dayKey(u.created_at);
      (map.get(k) ?? map.set(k, []).get(k)!).push(u);
    }
    return [...map.entries()];
  }, [shown]);

  if (shown.length === 0) {
    return <p className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 px-4 py-10 text-center text-sm text-neutral-400">No updates yet. Post the first one above.</p>;
  }

  return (
    <div className="space-y-6">
      {groups.map(([day, rows]) => (
        <div key={day}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">{day}</div>
          <ol className="relative space-y-3 border-l border-neutral-200 pl-5">
            {rows.map((u) => (
              <li key={u.id} className="relative">
                <span className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-4 ring-neutral-100" />
                <div className="group rounded-xl bg-white p-3 shadow-sm ring-1 ring-neutral-100">
                  <div className="mb-1 flex items-center gap-2">
                    <Tag color={colorOf(UPDATE_CATS, u.category)}>{labelOf(UPDATE_CATS, u.category)}</Tag>
                    {u.pinned ? <Tag color="amber">Pinned</Tag> : null}
                    <span className="ml-auto text-xs text-neutral-400">{relTime(u.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-neutral-800">{u.body}</p>
                  {(onTogglePin || onDelete) && (
                    <div className="mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                      {onTogglePin && (
                        <button onClick={() => onTogglePin(u)} className="rounded-md px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                          {u.pinned ? "Unpin" : "Pin"}
                        </button>
                      )}
                      {onDelete && <DeleteButton onClick={() => onDelete(u.id)} />}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
