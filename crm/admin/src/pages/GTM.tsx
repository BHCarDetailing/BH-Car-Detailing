import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader, Button, Card } from "../components/ui";
import { api } from "../api";
import { useCollection, type Row } from "../lib/collections";

interface Member extends Row { name: string; role: string | null; focus: string | null; }

const SECTIONS = [
  { key: "gtm_mission", title: "Mission", placeholder: "Why BH Car Details exists and who it serves…" },
  { key: "gtm_vision", title: "Vision", placeholder: "Where the business is going in the next 1–3 years…" },
  { key: "gtm_values", title: "Values", placeholder: "The principles the team operates by (one per line)…" },
  { key: "gtm_plan", title: "Execution plan", placeholder: "Step-by-step go-to-market plan and current priorities…" },
] as const;

export default function GTM() {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const { items: team } = useCollection<Member>("team");

  useEffect(() => {
    api<{ settings: Record<string, string> }>("/api/settings")
      .then((r) => setVals(r.settings ?? {}))
      .catch(() => {});
  }, []);

  function edit(key: string, v: string) {
    setVals((p) => ({ ...p, [key]: v }));
    setDirty((p) => new Set(p).add(key));
  }

  async function save() {
    setSaving(true);
    try {
      for (const key of dirty) {
        await api("/api/settings", { method: "PUT", body: JSON.stringify({ key, value: vals[key] ?? "" }) });
      }
      setDirty(new Set());
      setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    } finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <PageHeader eyebrow="Growth" title="Go-To-Market" subtitle="Alignment hub — mission, vision, values, team, and the plan."
        action={dirty.size > 0
          ? <Button onClick={save} disabled={saving}>{saving ? "Saving…" : `Save ${dirty.size} change${dirty.size === 1 ? "" : "s"}`}</Button>
          : savedAt ? <span className="text-xs text-neutral-400">Saved {savedAt}</span> : undefined} />

      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <Card key={s.key}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{s.title}</h2>
            <textarea
              value={vals[s.key] ?? ""}
              onChange={(e) => edit(s.key, e.target.value)}
              placeholder={s.placeholder}
              className="min-h-[130px] w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
            />
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Team & roles</h2>
          <Link to="/team" className="text-xs font-medium text-red-600 hover:underline">Manage team →</Link>
        </div>
        {team.length === 0 ? (
          <Card><p className="text-sm text-neutral-400">No team members yet. <Link to="/team" className="text-red-600 hover:underline">Add your crew</Link> to map roles here.</p></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {team.map((m) => (
              <div key={m.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-100">
                <div className="font-medium text-neutral-900">{m.name}</div>
                {m.role && <div className="text-sm text-red-600">{m.role}</div>}
                {m.focus && <div className="mt-1 text-xs text-neutral-500">{m.focus}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
