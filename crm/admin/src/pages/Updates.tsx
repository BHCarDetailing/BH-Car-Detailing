import { useMemo, useState } from "react";
import { PageHeader } from "../components/ui";
import { UpdateComposer, UpdateFeed, type UpdateRow } from "../components/UpdatesFeed";
import { useCollection, UPDATE_CATS } from "../lib/collections";

export default function Updates() {
  const { items, loading, create, update, remove } = useCollection<UpdateRow>("updates");
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((u) => u.category === filter)),
    [items, filter]
  );

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <PageHeader title="Updates" subtitle="Team activity feed — meetings, calls, car events, and wins in one timeline." />

      <div className="mb-5">
        <UpdateComposer onPost={(d) => create(d)} />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <button onClick={() => setFilter("all")}
          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${filter === "all" ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50"}`}>
          All
        </button>
        {UPDATE_CATS.map((c) => (
          <button key={c.value} onClick={() => setFilter(c.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${filter === c.value ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50"}`}>
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : (
        <UpdateFeed
          items={filtered}
          onDelete={remove}
          onTogglePin={(u) => update(u.id, { pinned: u.pinned ? 0 : 1 })}
        />
      )}
    </div>
  );
}
