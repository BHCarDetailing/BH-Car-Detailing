import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { fullName, money, SIZE_CLASSES, STAGES, type Activity, type Contact, type EmailMessage, type Job, type Label, type QuoteItem, type Service, type SizeClass, type SmsMessage, type Stage } from "../types";
import { Modal, Button, Tag } from "../components/ui";
import { REVENUE_STATUS, colorOf, labelOf } from "../lib/collections";
import { useToast } from "../components/Toast";
import { fmtDate } from "../lib/datetime";

interface TaskRow { id: string; title: string; due_at: string | null; status: string }

function touch(contactId: string, channel: "sms" | "call") {
  // Fire-and-forget: log the bridge outreach; the sms:/tel: link opens the phone's app.
  api(`/api/contacts/${contactId}/touch`, { method: "POST", body: JSON.stringify({ channel }) }).catch(() => {});
}

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [contact, setContact] = useState<Contact | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hiddenJobs, setHiddenJobs] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    if (!id) return;
    api<Contact>(`/api/contacts/${id}`).then(setContact).catch(() => {});
    api<{ items: Activity[] }>(`/api/contacts/${id}/activities`).then((r) => setActivities(r.items)).catch(() => {});
    api<{ items: Job[] }>(`/api/jobs?contact_id=${id}`).then((r) => setJobs(r.items)).catch(() => {});
    api<{ items: SmsMessage[] }>(`/api/messages?contact_id=${id}`).then((r) => setMessages(r.items)).catch(() => {});
    api<{ items: EmailMessage[] }>(`/api/messages?contact_id=${id}&channel=email`).then((r) => setEmails(r.items)).catch(() => {});
    api<{ items: TaskRow[] }>(`/api/tasks?contact_id=${id}&status=open`).then((r) => setTasks(r.items)).catch(() => {});
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => { api<{ items: Label[] }>("/api/labels").then((r) => setLabels(r.items)).catch(() => {}); }, []);

  async function archiveContact() {
    if (!id || !contact) return;
    const name = fullName(contact);
    setConfirmDelete(false);
    try {
      await api(`/api/contacts/${id}`, { method: "DELETE" });
      navigate("/contacts");
      toast({
        message: `Archived ${name}.`, actionLabel: "Undo", duration: 6000,
        onAction: async () => { await api(`/api/contacts/${id}/restore`, { method: "POST" }).catch(() => {}); navigate(`/contacts/${id}`); },
      });
    } catch {
      setActionError("Couldn't archive — try again.");
    }
  }

  // Delete a job/quote with a 5-second grace window (Undo) before the server
  // DELETE fires.
  function deleteJob(job: Job) {
    setHiddenJobs((prev) => new Set(prev).add(job.id));
    let undone = false;
    const timer = setTimeout(() => {
      if (!undone) api(`/api/jobs/${job.id}`, { method: "DELETE" }).then(load).catch(load);
    }, 5000);
    toast({
      message: `Deleted “${job.title}”.`, actionLabel: "Undo", duration: 5000,
      onAction: () => { undone = true; clearTimeout(timer); setHiddenJobs((prev) => { const n = new Set(prev); n.delete(job.id); return n; }); },
    });
  }

  async function quicklog(type: "call_logged" | "note", title: string) {
    await api(`/api/contacts/${id}/activities`, { method: "POST", body: JSON.stringify({ type, title }) });
    load();
  }
  async function toggleLabel(key: string) {
    const cur = contact?.tags ?? [];
    const next = cur.includes(key) ? cur.filter((t) => t !== key) : [...cur, key];
    await api(`/api/contacts/${id}`, { method: "PATCH", body: JSON.stringify({ tags: next }) });
    load();
  }
  async function requestReview(jobId: string) {
    try {
      const r = (await api(`/api/jobs/${jobId}/request-review`, { method: "POST" })) as { status: string };
      setActionError(r.status === "no_review_url" ? "Add your Google review link in Settings first." : "");
    } catch (e) {
      setActionError((e as { status?: number })?.status === 400 ? "Add your Google review link in Settings first." : "Couldn't send review request.");
    }
    load();
  }

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
          <div className="flex items-center gap-2">
            <select
              value={contact.stage}
              onChange={(e) => setStage(e.target.value as Stage)}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm capitalize min-h-[44px]"
            >
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={() => setConfirmDelete(true)} aria-label="Delete contact"
              className="grid h-11 w-11 place-items-center rounded-md border border-neutral-200 text-neutral-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-500">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
            </button>
          </div>
        </div>

        {actionError && <p className="text-sm text-red-600">{actionError}</p>}

        {(contact.ai_summary || contact.ai_next_action) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">AI summary</div>
            {contact.ai_summary && <p className="text-neutral-800">{contact.ai_summary}</p>}
            {contact.ai_next_action && <p className="mt-1 text-amber-800"><strong>Next:</strong> {contact.ai_next_action}</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {contact.phone && (
            <>
              <a href={`sms:${contact.phone}`} onClick={() => touch(id!, "sms")} className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white min-h-[44px] flex items-center">Text {contact.phone}</a>
              <a href={`tel:${contact.phone}`} onClick={() => touch(id!, "call")} className="rounded-md bg-neutral-200 px-4 py-2 text-sm min-h-[44px] flex items-center">Call</a>
            </>
          )}
          {contact.email && <a href={`mailto:${contact.email}`} className="rounded-md bg-neutral-200 px-4 py-2 text-sm min-h-[44px] flex items-center">Email</a>}
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => quicklog("call_logged", "Logged a call")} className="min-h-[40px] rounded-md bg-neutral-100 px-3 text-sm text-neutral-700">＋ Log call</button>
          <button onClick={() => { const t = prompt("Note:"); if (t) quicklog("note", t); }} className="min-h-[40px] rounded-md bg-neutral-100 px-3 text-sm text-neutral-700">＋ Log note</button>
        </div>

        <NextStep contactId={id!} tasks={tasks} onChange={load} />

        {contact.phone && (
          <section className="rounded-xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-medium">Messages</h2>
            <MessageThread messages={messages} />
            <Composer contactId={id!} onSent={load} />
          </section>
        )}

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-medium">Emails</h2>
          <EmailHistory emails={emails} />
        </section>

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
          <QuoteBuilder contactId={id!} vehicles={contact.vehicles ?? []} onCreated={load} />
          {jobs.filter((j) => !hiddenJobs.has(j.id)).length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">No jobs yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {jobs.filter((j) => !hiddenJobs.has(j.id)).map((j) => (
                <li key={j.id} className="rounded-lg border border-neutral-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{j.title}</div>
                      <div className="text-xs text-neutral-500">
                        {money(j.price_cents)}{j.scheduled_start ? ` · ${new Date(j.scheduled_start).toLocaleString()}` : ""}
                        {j.quote_accepted_at && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">✓ Accepted</span>}
                        {(j.amount_paid_cents ?? 0) > 0 && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">{Number(j.paid_in_full) === 1 ? `Paid ${money(j.amount_paid_cents!)}` : `${money(j.amount_paid_cents!)} paid`}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {(j.status === "completed" || j.status === "paid") && <button onClick={() => requestReview(j.id)} className="min-h-[40px] rounded-md bg-amber-100 px-3 text-sm text-amber-800">★ Review</button>}
                      <select value={j.status} onChange={async (e) => { await api(`/api/jobs/${j.id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) }); load(); }}
                        className="min-h-[44px] rounded-md border border-neutral-300 px-2 text-sm capitalize">
                        {["draft","quoted","scheduled","in_progress","completed","paid","cancelled"].map((s) => <option key={s} value={s}>{s.replace("_"," ")}</option>)}
                      </select>
                      <button onClick={() => deleteJob(j)} aria-label="Delete job" className="grid h-9 w-9 place-items-center rounded-md text-neutral-300 hover:bg-rose-50 hover:text-rose-500">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
                      </button>
                    </div>
                  </div>
                  {j.status === "quoted" && <SendQuote job={j} customerName={contact.first_name} customerPhone={contact.phone} customerEmail={contact.email} onSent={load} />}
                  {Number(j.paid_in_full) !== 1 && <MarkPaid job={j} onDone={load} />}
                </li>
              ))}
            </ul>
          )}
        </section>

        {(contact.revenue?.length ?? 0) > 0 && (
          <section className="rounded-xl bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">Revenue</h2>
              <span className="text-sm font-semibold text-graphite-950">{money(contact.related?.paid_revenue_cents ?? 0)} <span className="font-normal text-neutral-400">paid</span></span>
            </div>
            <ul className="divide-y divide-steel-100">
              {contact.revenue!.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-graphite-950">{r.label}</div>
                    <div className="text-xs text-neutral-400">{fmtDate(new Date(r.occurred_at ?? r.created_at))}{r.service ? ` · ${r.service}` : ""}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Tag color={colorOf(REVENUE_STATUS, r.status)}>{labelOf(REVENUE_STATUS, r.status)}</Tag>
                    <span className={`font-semibold ${r.status === "paid" ? "text-graphite-950" : "text-neutral-400"}`}>{money(r.amount_cents)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

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
        <EnrollControl contactId={id!} />
        {labels.length > 0 && (
          <section className="rounded-xl bg-white p-5 text-sm shadow-sm">
            <h2 className="mb-3 font-medium">Labels</h2>
            <div className="flex flex-wrap gap-2">
              {labels.map((l) => {
                const on = (contact.tags ?? []).includes(l.key);
                return (
                  <button key={l.key} onClick={() => toggleLabel(l.key)}
                    className="rounded-full border px-3 py-1 text-xs"
                    style={on ? { backgroundColor: l.color, borderColor: l.color, color: "#fff" } : { borderColor: l.color, color: l.color }}>
                    {l.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}
        <EditableDetails contact={contact} onSaved={load} />
      </aside>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Archive this contact?" size="sm"
        footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={archiveContact}>Archive contact</Button></>}>
        <div className="space-y-3 text-sm">
          <p className="text-neutral-700"><span className="font-medium">{fullName(contact)}</span> will be hidden from your contacts. You can restore them anytime from the Archive, and you'll get a 5-second Undo.</p>
          {((contact.related?.jobs ?? 0) > 0 || (contact.related?.paid_revenue_cents ?? 0) > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
              <div className="font-medium">Heads up — this contact has money history</div>
              <div className="mt-0.5 text-xs">
                {(contact.related?.jobs ?? 0) > 0 && <>{contact.related!.jobs} job{contact.related!.jobs === 1 ? "" : "s"}</>}
                {(contact.related?.jobs ?? 0) > 0 && (contact.related?.paid_revenue_cents ?? 0) > 0 && " · "}
                {(contact.related?.paid_revenue_cents ?? 0) > 0 && <>{money(contact.related!.paid_revenue_cents)} paid revenue</>}
                . It's preserved and comes back on restore.
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

function EmailHistory({ emails }: { emails: EmailMessage[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (emails.length === 0) return <p className="text-sm text-neutral-500">No emails yet. Sent sequence and booking emails show here with their full content.</p>;
  const badge: Record<string, string> = { sent: "green", logged: "neutral", failed: "red", queued: "amber" };
  return (
    <ul className="divide-y divide-steel-100">
      {emails.map((m) => {
        const open = openId === m.id;
        return (
          <li key={m.id} className="py-2.5">
            <button onClick={() => setOpenId(open ? null : m.id)} className="flex w-full items-center gap-3 text-left">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-graphite-950">{m.subject || "(no subject)"}</div>
                <div className="text-xs text-neutral-400">{new Date(m.created_at).toLocaleString()}{m.kind ? ` · ${m.kind}` : ""}</div>
              </div>
              <Tag color={badge[m.status] ?? "neutral"}>{m.status}</Tag>
            </button>
            {open && m.body_text && (
              <div className="mt-2 whitespace-pre-wrap rounded-lg bg-steel-50 p-3 text-sm text-neutral-700">{m.body_text}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function NextStep({ contactId, tasks, onChange }: { contactId: string; tasks: TaskRow[]; onChange: () => void }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await api("/api/tasks", { method: "POST", body: JSON.stringify({ contact_id: contactId, title: title.trim(), due_at: due ? new Date(due).toISOString() : null }) });
    setTitle(""); setDue(""); onChange();
  }
  async function done(taskId: string) {
    await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
    onChange();
  }
  return (
    <section className="rounded-xl bg-white p-5 shadow-sm">
      <h2 className="mb-3 font-medium">Next steps</h2>
      {tasks.length > 0 && (
        <ul className="mb-3 space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
              <span><input type="checkbox" onChange={() => done(t.id)} className="mr-2" />{t.title}{t.due_at && <span className="ml-2 text-xs text-neutral-400">{new Date(t.due_at).toLocaleDateString()}</span>}</span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Set a next step…" className="min-h-[44px] flex-1 rounded-md border border-neutral-300 px-3 text-sm" />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="min-h-[44px] rounded-md border border-neutral-300 px-2 text-sm" />
        <button className="min-h-[44px] rounded-md bg-neutral-900 px-4 text-sm text-white">Add</button>
      </form>
    </section>
  );
}

function EditableDetails({ contact, onSaved }: { contact: Contact; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({
    first_name: contact.first_name ?? "", last_name: contact.last_name ?? "",
    email: contact.email ?? "", phone: contact.phone ?? "", address: contact.address ?? "", city: contact.city ?? "",
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/contacts/${contact.id}`, { method: "PATCH", body: JSON.stringify(f) });
      setEdit(false); onSaved();
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  return (
    <section className="rounded-xl bg-white p-5 text-sm shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">Details</h2>
        {!edit && <button onClick={() => setEdit(true)} className="text-xs text-red-600 hover:underline">Edit</button>}
      </div>
      {edit ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} placeholder="First" className="min-h-[44px] w-full rounded-md border border-neutral-300 px-2" />
            <input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} placeholder="Last" className="min-h-[44px] w-full rounded-md border border-neutral-300 px-2" />
          </div>
          <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email" className="min-h-[44px] w-full rounded-md border border-neutral-300 px-2" />
          <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Phone" className="min-h-[44px] w-full rounded-md border border-neutral-300 px-2" />
          <input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Address" className="min-h-[44px] w-full rounded-md border border-neutral-300 px-2" />
          <input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="City" className="min-h-[44px] w-full rounded-md border border-neutral-300 px-2" />
          <div className="flex gap-2">
            <button disabled={busy} onClick={save} className="min-h-[44px] flex-1 rounded-md bg-red-600 px-4 text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
            <button onClick={() => setEdit(false)} className="min-h-[44px] rounded-md bg-neutral-200 px-4">Cancel</button>
          </div>
        </div>
      ) : (
        <dl className="space-y-2">
          <div><dt className="text-neutral-400">Email</dt><dd>{contact.email ?? "—"}</dd></div>
          <div><dt className="text-neutral-400">Phone</dt><dd>{contact.phone ?? "—"}</dd></div>
          <div><dt className="text-neutral-400">Address</dt><dd>{[contact.address, contact.city].filter(Boolean).join(", ") || "—"}</dd></div>
          <div><dt className="text-neutral-400">Created</dt><dd>{new Date(contact.created_at).toLocaleString()}</dd></div>
        </dl>
      )}
    </section>
  );
}

function EnrollControl({ contactId }: { contactId: string }) {
  const [seqs, setSeqs] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    api<{ items: Array<{ id: string; name: string; status: string }> }>("/api/sequences")
      .then((r) => setSeqs(r.items.filter((s) => s.status === "active")))
      .catch(() => {});
  }, []);

  if (seqs.length === 0) return null;

  async function enroll(seqId: string) {
    if (!seqId) return;
    setNote("");
    try {
      const r = (await api(`/api/sequences/${seqId}/enroll`, { method: "POST", body: JSON.stringify({ contact_id: contactId }) })) as { status: string };
      setNote(r.status === "enrolled" ? "Enrolled." : r.status === "already_enrolled" ? "Already in this sequence." : r.status);
    } catch { setNote("Couldn't enroll — try again."); }
  }

  return (
    <section className="rounded-xl bg-white p-5 text-sm shadow-sm">
      <h2 className="mb-2 font-medium">Email sequence</h2>
      <select defaultValue="" onChange={(e) => enroll(e.target.value)} className="min-h-[44px] w-full rounded-md border border-neutral-300 px-2 text-sm">
        <option value="">Enroll in…</option>
        {seqs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {note && <p className="mt-2 text-xs text-neutral-500">{note}</p>}
    </section>
  );
}

function MessageThread({ messages }: { messages: SmsMessage[] }) {
  if (messages.length === 0) return <p className="mb-3 text-sm text-neutral-500">No texts yet.</p>;
  return (
    <div className="mb-3 max-h-72 space-y-2 overflow-y-auto">
      {messages.map((m) => {
        const out = m.direction === "outbound";
        return (
          <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${out ? "bg-red-600 text-white" : "bg-neutral-100 text-neutral-900"}`}>
              <div className="whitespace-pre-wrap break-words">{m.body_text}</div>
              <div className={`mt-0.5 text-[10px] ${out ? "text-red-100" : "text-neutral-400"}`}>
                {new Date(m.created_at).toLocaleString()}{out && m.status ? ` · ${m.status}` : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Composer({ contactId, onSent }: { contactId: string; onSent: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [note, setNote] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true); setNote("");
    try {
      const r = (await api(`/api/messages`, { method: "POST", body: JSON.stringify({ contact_id: contactId, body: body.trim() }) })) as { status: string };
      setBody("");
      setNote(r.status === "sent" ? "Sent." : r.status === "logged" ? "Saved — texting goes live once Twilio is connected." : `Status: ${r.status}`);
      onSent();
    } catch { setNote("Couldn't send — try again."); }
    finally { setBusy(false); }
  }

  async function draft() {
    setDrafting(true); setNote("");
    try {
      const r = (await api(`/api/ai/draft`, { method: "POST", body: JSON.stringify({ contact_id: contactId, channel: "sms" }) })) as { text: string };
      setBody(r.text);
    } catch (e) {
      setNote((e as { status?: number })?.status === 503 ? "AI drafting turns on once your Anthropic key is added." : "Couldn't draft — try again.");
    } finally { setDrafting(false); }
  }

  return (
    <form onSubmit={send} className="space-y-2">
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Type a text…" className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-600" />
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={busy} className="min-h-[44px] rounded-md bg-red-600 px-4 text-sm text-white disabled:opacity-50">{busy ? "Sending…" : "Send text"}</button>
        <button type="button" disabled={drafting} onClick={draft} className="min-h-[44px] rounded-md bg-neutral-200 px-4 text-sm disabled:opacity-50">{drafting ? "Drafting…" : "✨ Draft with AI"}</button>
        {note && <span className="text-xs text-neutral-500">{note}</span>}
      </div>
    </form>
  );
}

function MarkPaid({ job, onDone }: { job: Job; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const remaining = Math.max(0, job.price_cents - (job.amount_paid_cents ?? 0));
  const [amount, setAmount] = useState(((remaining || job.price_cents) / 100).toFixed(2));
  const [method, setMethod] = useState("zelle");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const cents = Math.round((parseFloat(amount) || 0) * 100);
    if (cents <= 0) return;
    setBusy(true);
    try {
      await api(`/api/jobs/${job.id}/mark-paid`, { method: "POST", body: JSON.stringify({ amount_cents: cents, method }) });
      setOpen(false); onDone();
    } finally { setBusy(false); }
  }

  if (!open) return (
    <div className="mt-2">
      <button onClick={() => setOpen(true)} className="min-h-[36px] rounded-md bg-neutral-100 px-3 text-sm text-neutral-700">＋ Mark paid (Zelle / cash / check)</button>
    </div>
  );
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 p-2">
      <span className="text-sm text-neutral-500">$</span>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="min-h-[40px] w-24 rounded-md border border-neutral-300 px-2 text-sm" />
      <select value={method} onChange={(e) => setMethod(e.target.value)} className="min-h-[40px] rounded-md border border-neutral-300 px-2 text-sm">
        <option value="zelle">Zelle</option>
        <option value="cash">Cash</option>
        <option value="check">Check</option>
        <option value="card_external">Card (in person)</option>
        <option value="other">Other</option>
      </select>
      <button disabled={busy} onClick={submit} className="min-h-[40px] rounded-md bg-red-600 px-3 text-sm text-white disabled:opacity-50">Record</button>
      <button onClick={() => setOpen(false)} className="min-h-[40px] rounded-md bg-neutral-200 px-3 text-sm">Cancel</button>
    </div>
  );
}

function priceFor(svc: Service, size: SizeClass): number {
  return svc.size_pricing[size] ?? svc.base_price_cents ?? 0;
}

function QuoteBuilder({ contactId, vehicles, onCreated }: { contactId: string; vehicles: Contact["vehicles"]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [size, setSize] = useState<SizeClass>("sedan");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [discount, setDiscount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    api<{ items: Service[] }>("/api/services?active=1").then((r) => setServices(r.items)).catch(() => {});
    const v0 = (vehicles ?? [])[0]?.size_class as SizeClass | undefined;
    if (v0 && (SIZE_CLASSES as readonly string[]).includes(v0)) setSize(v0);
  }, [open, vehicles]);

  const items: QuoteItem[] = services
    .filter((s) => (qty[s.id] ?? 0) > 0)
    .map((s) => ({ service_id: s.id, name: s.name, price_cents: priceFor(s, size), qty: qty[s.id] }));
  const customCents = Math.round((parseFloat(customPrice) || 0) * 100);
  if (customName.trim() && customCents > 0) items.push({ name: customName.trim(), price_cents: customCents, qty: 1 });
  const discountCents = Math.round((parseFloat(discount) || 0) * 100);
  const subtotal = items.reduce((sum, it) => sum + it.price_cents * it.qty, 0);
  const total = Math.max(0, subtotal - discountCents);

  function bump(id: string, delta: number) {
    setQty((q) => ({ ...q, [id]: Math.max(0, (q[id] ?? 0) + delta) }));
  }

  async function submit() {
    if (items.length === 0) { setErr("Pick at least one service."); return; }
    setBusy(true); setErr("");
    const lineItems: QuoteItem[] = [...items];
    if (discountCents > 0) lineItems.push({ name: "Discount", price_cents: -discountCents, qty: 1 });
    const title = items.map((i) => i.qty > 1 ? `${i.name} ×${i.qty}` : i.name).join(", ").slice(0, 120);
    try {
      await api("/api/jobs", { method: "POST", body: JSON.stringify({
        contact_id: contactId, title, status: "quoted", price_cents: total, services: lineItems,
      }) });
      setQty({}); setCustomName(""); setCustomPrice(""); setDiscount(""); setOpen(false); onCreated();
    } catch { setErr("Couldn't save — try again."); }
    finally { setBusy(false); }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="min-h-[44px] rounded-md bg-neutral-900 px-4 text-sm text-white">＋ Build a quote</button>;

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 p-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-neutral-600">Vehicle size</span>
        <select value={size} onChange={(e) => setSize(e.target.value as SizeClass)} className="min-h-[40px] rounded-md border border-neutral-300 px-2 text-sm capitalize">
          {SIZE_CLASSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      {services.length === 0 ? (
        <p className="text-sm text-neutral-500">No services yet. Add your menu in Settings → Services.</p>
      ) : (
        <ul className="divide-y">
          {services.map((s) => {
            const n = qty[s.id] ?? 0;
            return (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-neutral-500">{money(priceFor(s, size))}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => bump(s.id, -1)} className="h-8 w-8 rounded-md bg-neutral-100 text-lg leading-none">−</button>
                  <span className="w-5 text-center text-sm">{n}</span>
                  <button type="button" onClick={() => bump(s.id, 1)} className="h-8 w-8 rounded-md bg-neutral-100 text-lg leading-none">＋</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-2">
        <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Custom line (optional)" className="min-h-[40px] flex-1 rounded-md border border-neutral-300 px-2 text-sm" />
        <input value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} inputMode="decimal" placeholder="$" className="min-h-[40px] w-20 rounded-md border border-neutral-300 px-2 text-sm" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-neutral-600">Discount $</span>
        <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" placeholder="0" className="min-h-[40px] w-24 rounded-md border border-neutral-300 px-2 text-sm" />
      </label>

      <div className="flex items-center justify-between border-t pt-2">
        <span className="text-sm text-neutral-500">Total</span>
        <span className="text-xl font-bold">{money(total)}</span>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button disabled={busy} onClick={submit} className="min-h-[44px] flex-1 rounded-md bg-red-600 px-4 text-sm text-white disabled:opacity-50">{busy ? "Saving…" : "Save quote"}</button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] rounded-md bg-neutral-200 px-4 text-sm">Cancel</button>
      </div>
    </div>
  );
}

function SendQuote({ job, customerName, customerPhone, customerEmail, onSent }: { job: Job; customerName: string | null; customerPhone: string | null; customerEmail: string | null; onSent: () => void }) {
  const [link, setLink] = useState(job.quote_token ? `${location.origin}/quote/${job.quote_token}` : "");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

  async function makeLink(): Promise<string> {
    if (link) return link;
    setBusy(true);
    try {
      const r = (await api(`/api/jobs/${job.id}/send-quote`, { method: "POST" })) as { path: string };
      const url = `${location.origin}${r.path}`;
      setLink(url); onSent();
      return url;
    } finally { setBusy(false); }
  }
  const message = (url: string) => `Hi${customerName ? " " + customerName : ""}! Here's your quote from BH Car Detailing for ${money(job.price_cents)}: ${url}\nReply STOP to opt out.`;

  async function copy() {
    const url = await makeLink();
    navigator.clipboard?.writeText(message(url));
    setCopied("msg"); setTimeout(() => setCopied(""), 1500);
  }
  async function copyLinkOnly() {
    const url = await makeLink();
    navigator.clipboard?.writeText(url);
    setCopied("link"); setTimeout(() => setCopied(""), 1500);
  }
  async function openText() {
    const url = await makeLink();
    if (customerPhone) location.href = `sms:${customerPhone}?&body=${encodeURIComponent(message(url))}`;
  }
  async function openEmail() {
    const url = await makeLink();
    if (customerEmail) location.href = `mailto:${customerEmail}?subject=${encodeURIComponent("Your BH Car Detailing quote")}&body=${encodeURIComponent(message(url))}`;
  }

  return (
    <div className="mt-3 border-t border-neutral-100 pt-3">
      <div className="mb-2 flex flex-wrap gap-2">
        {customerPhone && <button onClick={openText} disabled={busy} className="min-h-[40px] rounded-md bg-neutral-900 px-3 text-sm text-white disabled:opacity-50">Text quote</button>}
        {customerEmail && <button onClick={openEmail} disabled={busy} className="min-h-[40px] rounded-md bg-neutral-200 px-3 text-sm disabled:opacity-50">Email quote</button>}
        <button onClick={copy} disabled={busy} className="min-h-[40px] rounded-md bg-neutral-200 px-3 text-sm disabled:opacity-50">{copied === "msg" ? "Copied!" : "Copy message"}</button>
        <button onClick={copyLinkOnly} disabled={busy} className="min-h-[40px] rounded-md bg-neutral-200 px-3 text-sm disabled:opacity-50">{copied === "link" ? "Copied!" : "Copy link"}</button>
      </div>
      {link && <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-600" />}
    </div>
  );
}
