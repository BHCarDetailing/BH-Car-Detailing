import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { fullName, STAGES, type Activity, type Contact, type Job, type Stage } from "../types";

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState("");

  const load = useCallback(() => {
    if (!id) return;
    api<Contact>(`/api/contacts/${id}`).then(setContact).catch(() => {});
    api<{ items: Activity[] }>(`/api/contacts/${id}/activities`).then((r) => setActivities(r.items)).catch(() => {});
    api<{ items: Job[] }>(`/api/jobs?contact_id=${id}`).then((r) => setJobs(r.items)).catch(() => {});
  }, [id]);
  useEffect(load, [load]);

  async function setStage(stage: Stage) {
    setActionError("");
    try {
      await api(`/api/contacts/${id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
    } catch {
      setActionError("Couldn't update the stage — try again.");
    }
    load();
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setActionError("");
    try {
      await api(`/api/contacts/${id}/activities`, {
        method: "POST",
        body: JSON.stringify({ type: "note", title: note.trim() }),
      });
      setNote("");
    } catch {
      setActionError("Couldn't save the note — try again.");
    }
    load();
  }

  if (!contact) return <div className="p-4 text-neutral-500 md:p-8">Loading…</div>;

  return (
    <div className="grid gap-8 p-4 md:p-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{fullName(contact)}</h1>
            <div className="mt-1 text-sm text-neutral-500">
              {contact.source} {contact.area_slug && `· ${contact.area_slug}`}
            </div>
          </div>
          <select
            value={contact.stage}
            onChange={(e) => setStage(e.target.value as Stage)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm capitalize min-h-[44px]"
          >
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {actionError && <p className="text-sm text-red-600">{actionError}</p>}

        <div className="flex flex-wrap gap-2">
          {contact.phone && (
            <>
              <a href={`sms:${contact.phone}`} className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white min-h-[44px] flex items-center">Text {contact.phone}</a>
              <a href={`tel:${contact.phone}`} className="rounded-md bg-neutral-200 px-4 py-2 text-sm min-h-[44px] flex items-center">Call</a>
            </>
          )}
          {contact.email && <a href={`mailto:${contact.email}`} className="rounded-md bg-neutral-200 px-4 py-2 text-sm min-h-[44px] flex items-center">Email</a>}
        </div>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-medium">Vehicles</h2>
          {(contact.vehicles ?? []).length === 0 ? (
            <p className="text-sm text-neutral-500">None recorded.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {contact.vehicles!.map((v) => (
                <li key={v.id}>
                  <span className="capitalize">{v.size_class}</span>
                  {v.notes && <span className="text-neutral-500"> — {v.notes}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-medium">Jobs & Quotes</h2>
          <NewJob contactId={id!} onCreated={load} />
          {jobs.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">No jobs yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 p-3">
                  <div className="min-w-0">
                    <div className="font-medium">{j.title}</div>
                    <div className="text-xs text-neutral-500">
                      ${(j.price_cents / 100).toFixed(2)}{j.scheduled_start ? ` · ${new Date(j.scheduled_start).toLocaleString()}` : ""}
                    </div>
                  </div>
                  <select value={j.status} onChange={async (e) => { await api(`/api/jobs/${j.id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) }); load(); }}
                    className="min-h-[44px] rounded-md border border-neutral-300 px-2 text-sm capitalize">
                    {["draft","quoted","scheduled","in_progress","completed","paid","cancelled"].map((s) => <option key={s} value={s}>{s.replace("_"," ")}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-medium">Timeline</h2>
          <form onSubmit={addNote} className="mb-4 flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note…"
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-600"
            />
            <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white min-h-[44px] flex items-center">Save</button>
          </form>
          <ul className="space-y-3">
            {activities.map((a) => (
              <li key={a.id} className="border-l-2 border-neutral-200 pl-3 text-sm">
                <div>{a.title}</div>
                <div className="text-xs text-neutral-400">
                  {a.type} · {a.actor} · {new Date(a.created_at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-xl bg-white p-5 text-sm shadow-sm">
          <h2 className="mb-3 font-medium">Details</h2>
          <dl className="space-y-2">
            <div><dt className="text-neutral-400">Email</dt><dd>{contact.email ?? "—"}</dd></div>
            <div><dt className="text-neutral-400">Phone</dt><dd>{contact.phone ?? "—"}</dd></div>
            <div><dt className="text-neutral-400">Address</dt><dd>{contact.address ?? "—"}</dd></div>
            <div><dt className="text-neutral-400">Created</dt><dd>{new Date(contact.created_at).toLocaleString()}</dd></div>
            <div><dt className="text-neutral-400">Tags</dt><dd>{(contact.tags ?? []).join(", ") || "—"}</dd></div>
          </dl>
          {Object.keys(contact.custom ?? {}).length > 0 && (
            <>
              <h3 className="mt-4 mb-2 font-medium">Custom fields</h3>
              <dl className="space-y-2">
                {Object.entries(contact.custom!).map(([k, v]) => (
                  <div key={k}><dt className="text-neutral-400">{k}</dt><dd>{String(v)}</dd></div>
                ))}
              </dl>
            </>
          )}
        </section>
      </aside>
    </div>
  );
}

function NewJob({ contactId, onCreated }: { contactId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true); setErr("");
    try {
      await api("/api/jobs", { method: "POST", body: JSON.stringify({
        contact_id: contactId, title: title.trim(), status: "quoted",
        price_cents: Math.round((parseFloat(price) || 0) * 100),
      }) });
      setTitle(""); setPrice(""); setOpen(false); onCreated();
    } catch { setErr("Couldn't save — try again."); }
    finally { setBusy(false); }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="min-h-[44px] rounded-md bg-neutral-900 px-4 text-sm text-white">＋ New quote / job</button>;
  return (
    <form onSubmit={submit} className="space-y-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ceramic coating" className="min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" autoFocus />
      <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="Price (e.g. 750)" className="min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" />
      <div className="flex gap-2">
        <button disabled={busy} className="min-h-[44px] flex-1 rounded-md bg-red-600 px-4 text-sm text-white disabled:opacity-50">{busy ? "Saving…" : "Save quote"}</button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] rounded-md bg-neutral-200 px-4 text-sm">Cancel</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </form>
  );
}
