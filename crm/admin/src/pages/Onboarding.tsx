import { useMemo, useState } from "react";
import { PageHeader, Button, Modal, Field, Input, Select, EmptyState, DeleteButton } from "../components/ui";
import { useCollection, ONBOARD_STATUS, type Row } from "../lib/collections";

interface Item extends Row { subject: string; step: string; status: string; }
const BLANK = { subject: "", step: "", status: "todo" };

// Reusable onboarding templates per role — applied as a checklist for a person.
const TEMPLATES: { role: string; steps: string[] }[] = [
  { role: "Employee", steps: ["Sign employment agreement", "Complete safety training", "Learn products & pricing", "Shadow a full detail", "Receive equipment & supplies", "First solo job reviewed"] },
  { role: "Door Knocker", steps: ["Assign territory", "Script & pitch training", "Objection handling practice", "Ride-along with a closer", "Knock first 25 doors", "Set up daily reporting"] },
  { role: "Founder", steps: ["Review vision, mission & values", "Access to all systems", "Set quarterly KPIs", "Establish weekly cadence", "Review legal & financial docs"] },
  { role: "Partner", steps: ["Sign partnership agreement", "Confirm revenue-share terms", "Set primary point of contact", "Set up referral tracking", "Kickoff call"] },
  { role: "Car Club Partner", steps: ["Sign club agreement", "Create member discount code", "Share event schedule", "Plan social cross-promo", "Book first club event"] },
  { role: "Brand Partner", steps: ["Sign brand agreement", "Share brand asset kit", "Build co-marketing plan", "Set up tracking links", "Confirm launch date"] },
  { role: "Contractor", steps: ["Collect W-9 & agreement", "Verify insurance", "Define scope of work", "Confirm payment terms", "Grant portal access"] },
];

export default function Onboarding() {
  const { items, loading, create, update, remove, reload } = useCollection<Item>("onboarding");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplRole, setTplRole] = useState(TEMPLATES[0].role);
  const [tplSubject, setTplSubject] = useState("");
  const [tplBusy, setTplBusy] = useState(false);

  async function applyTemplate() {
    const tpl = TEMPLATES.find((t) => t.role === tplRole);
    const subject = tplSubject.trim() || tplRole;
    if (!tpl) return;
    setTplBusy(true);
    try {
      let sort = items.filter((i) => i.subject === subject).length;
      for (const step of tpl.steps) await create({ subject, step, status: "todo", sort: sort++ });
      await reload();
      setTplOpen(false); setTplSubject("");
    } finally { setTplBusy(false); }
  }

  const subjects = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) (map.get(it.subject) ?? map.set(it.subject, []).get(it.subject)!).push(it);
    return [...map.entries()];
  }, [items]);
  const knownSubjects = useMemo(() => [...new Set(items.map((i) => i.subject))], [items]);

  async function save() {
    if (!form.subject.trim() || !form.step.trim()) return;
    setBusy(true);
    try { await create(form); setForm({ ...BLANK, subject: form.subject }); setOpen(false); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <PageHeader eyebrow="Operations" title="Onboarding" subtitle="Bring new team members and users up to speed — step by step."
        action={<div className="flex gap-2">
          <Button variant="ghost" onClick={() => { setTplSubject(""); setTplOpen(true); }}>Use a template</Button>
          <Button onClick={() => { setForm(BLANK); setOpen(true); }}>+ Add step</Button>
        </div>} />

      {loading ? <p className="text-sm text-neutral-400">Loading…</p> : subjects.length === 0 ? (
        <EmptyState title="No onboarding tracks yet" hint="Add steps for a new hire or user to track their progress." action={<Button onClick={() => setOpen(true)}>+ Add step</Button>} />
      ) : (
        <div className="space-y-5">
          {subjects.map(([subject, steps]) => {
            const done = steps.filter((s) => s.status === "done").length;
            const pct = Math.round((done / steps.length) * 100);
            return (
              <div key={subject} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-100">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="font-semibold text-neutral-900">{subject}</div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-red-500" style={{ width: `${pct}%` }} /></div>
                    <span className="text-xs text-neutral-500">{done}/{steps.length}</span>
                  </div>
                </div>
                <ul className="divide-y divide-neutral-100">
                  {steps.map((s) => (
                    <li key={s.id} className="group flex items-center gap-3 py-2.5">
                      <span className={`flex-1 text-sm ${s.status === "done" ? "text-neutral-400 line-through" : "text-neutral-700"}`}>{s.step}</span>
                      <select value={s.status} onChange={(e) => update(s.id, { status: e.target.value })}
                        className="h-8 rounded-lg border border-neutral-200 bg-white px-2 text-xs outline-none focus:border-red-400">
                        {ONBOARD_STATUS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <div className="opacity-0 transition group-hover:opacity-100"><DeleteButton onClick={() => remove(s.id)} /></div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add onboarding step" size="sm"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add"}</Button></>}>
        <div className="space-y-3">
          <Field label="Who is being onboarded" hint={knownSubjects.length ? `Existing: ${knownSubjects.join(", ")}` : undefined}>
            <Input value={form.subject} autoFocus onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Name or role" list="onboard-subjects" />
            <datalist id="onboard-subjects">{knownSubjects.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="Step"><Input value={form.step} onChange={(e) => setForm({ ...form, step: e.target.value })} placeholder="e.g. Complete safety training" /></Field>
          <Field label="Status"><Select options={ONBOARD_STATUS} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={tplOpen} onClose={() => setTplOpen(false)} title="Apply onboarding template" size="sm"
        footer={<><Button variant="ghost" onClick={() => setTplOpen(false)}>Cancel</Button><Button onClick={applyTemplate} disabled={tplBusy}>{tplBusy ? "Adding…" : "Apply template"}</Button></>}>
        <div className="space-y-3">
          <Field label="Role template">
            <Select options={TEMPLATES.map((t) => ({ value: t.role, label: t.role }))} value={tplRole} onChange={(e) => setTplRole(e.target.value)} />
          </Field>
          <Field label="Person / subject" hint="Leave blank to use the role name.">
            <Input value={tplSubject} autoFocus onChange={(e) => setTplSubject(e.target.value)} placeholder="e.g. Jordan (new detailer)" />
          </Field>
          <div className="rounded-lg bg-steel-50 p-3">
            <div className="mb-1 text-xs font-medium text-neutral-600">Adds {TEMPLATES.find((t) => t.role === tplRole)?.steps.length} steps:</div>
            <ul className="space-y-0.5 text-xs text-chrome-400">
              {TEMPLATES.find((t) => t.role === tplRole)?.steps.map((s) => <li key={s}>• {s}</li>)}
            </ul>
          </div>
        </div>
      </Modal>
    </div>
  );
}
