import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader, Button, Card, Tabs, Modal, Field, Input, Select, Textarea, Tag, EmptyState, DeleteButton, StatTile, Timestamp } from "../components/ui";
import { api } from "../api";
import {
  useCollection, labelOf, colorOf, type Row,
  PROSPECT_STATUS, CAMPAIGN_CHANNELS, CAMPAIGN_STATUS, CONTENT_CHANNELS, CONTENT_STATUS,
} from "../lib/collections";
import { money } from "../types";
import { fmtDate } from "../lib/datetime";

interface Member extends Row { name: string; role: string | null; focus: string | null }

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "prospecting", label: "Prospecting" },
  { value: "marketing", label: "Marketing" },
  { value: "content", label: "Content Calendar" },
] as const;

/* ---------------- Overview (mission/vision/values/plan + team) ---------------- */
const SECTIONS = [
  { key: "gtm_mission", title: "Mission", placeholder: "Why BH Car Details exists and who it serves…" },
  { key: "gtm_vision", title: "Vision", placeholder: "Where the business is going in the next 1–3 years…" },
  { key: "gtm_values", title: "Values", placeholder: "The principles the team operates by (one per line)…" },
  { key: "gtm_plan", title: "Execution plan", placeholder: "Step-by-step go-to-market plan and current priorities…" },
] as const;

function Overview() {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const { items: team } = useCollection<Member>("team");

  useEffect(() => { api<{ settings: Record<string, string> }>("/api/settings").then((r) => setVals(r.settings ?? {})).catch(() => {}); }, []);
  function edit(key: string, v: string) { setVals((p) => ({ ...p, [key]: v })); setDirty((p) => new Set(p).add(key)); }
  async function save() {
    setSaving(true);
    try {
      for (const key of dirty) await api("/api/settings", { method: "PUT", body: JSON.stringify({ key, value: vals[key] ?? "" }) });
      setDirty(new Set()); setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    } finally { setSaving(false); }
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        {dirty.size > 0
          ? <Button onClick={save} disabled={saving}>{saving ? "Saving…" : `Save ${dirty.size} change${dirty.size === 1 ? "" : "s"}`}</Button>
          : savedAt ? <span className="text-xs text-chrome-400">Saved {savedAt}</span> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <Card key={s.key}>
            <h2 className="eyebrow mb-2 text-[10px] text-chrome-400">{s.title}</h2>
            <textarea value={vals[s.key] ?? ""} onChange={(e) => edit(s.key, e.target.value)} placeholder={s.placeholder}
              className="min-h-[130px] w-full resize-y rounded-lg border border-steel-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" />
          </Card>
        ))}
      </div>
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="eyebrow text-[10px] text-chrome-400">Team & roles</h2>
          <Link to="/team" className="text-xs font-medium text-red-600 hover:underline">Manage team →</Link>
        </div>
        {team.length === 0 ? (
          <Card><p className="text-sm text-chrome-400">No team members yet. <Link to="/team" className="text-red-600 hover:underline">Add your crew</Link>.</p></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {team.map((m) => (
              <div key={m.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-steel-200">
                <div className="font-medium text-graphite-950">{m.name}</div>
                {m.role && <div className="text-sm text-red-600">{m.role}</div>}
                {m.focus && <div className="mt-1 text-xs text-chrome-400">{m.focus}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------- Prospecting ---------------- */
interface Prospect extends Row { name: string; source: string | null; status: string; next_follow_up: string | null; notes: string | null; created_at: string }
const P_BLANK = { name: "", source: "", status: "new", next_follow_up: "", notes: "" };

function Prospecting() {
  const { items, loading, create, update, remove } = useCollection<Prospect>("prospects");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(P_BLANK);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form.name.trim()) return;
    setBusy(true);
    try { await create(form); setForm(P_BLANK); setOpen(false); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => { setForm(P_BLANK); setOpen(true); }}>+ Add prospect</Button></div>
      {loading ? <p className="text-sm text-chrome-400">Loading…</p> : items.length === 0 ? (
        <EmptyState title="No prospects yet" hint="Track leads to contact, cold outreach, and follow-ups here." action={<Button onClick={() => setOpen(true)}>+ Add prospect</Button>} />
      ) : (
        <div className="space-y-2">
          {items.map((p) => (
            <div key={p.id} className="group flex flex-wrap items-center gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-steel-200">
              <div className="min-w-[160px] flex-1">
                <div className="font-medium text-graphite-950">{p.name}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-chrome-400">
                  {p.source && <span>{p.source}</span>}
                  {p.next_follow_up && <span>· follow up {fmtDate(p.next_follow_up)}</span>}
                  <Timestamp value={p.created_at} prefix="· added" />
                </div>
                {p.notes && <div className="mt-0.5 text-sm text-neutral-500">{p.notes}</div>}
              </div>
              <select value={p.status} onChange={(e) => update(p.id, { status: e.target.value })}
                className="h-8 rounded-lg border border-steel-200 bg-white px-2 text-xs outline-none focus:border-red-400">
                {PROSPECT_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <Tag color={colorOf(PROSPECT_STATUS, p.status)}>{labelOf(PROSPECT_STATUS, p.status)}</Tag>
              <div className="opacity-0 transition group-hover:opacity-100"><DeleteButton onClick={() => remove(p.id)} /></div>
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add prospect" size="sm"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add"}</Button></>}>
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Source"><Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Referral, IG, LSA…" /></Field>
            <Field label="Status"><Select options={PROSPECT_STATUS} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} /></Field>
          </div>
          <Field label="Next follow-up"><Input type="date" value={form.next_follow_up} onChange={(e) => setForm({ ...form, next_follow_up: e.target.value })} /></Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

/* ---------------- Marketing ---------------- */
interface Campaign extends Row { name: string; channel: string; status: string; spend_cents: number; leads: number; start_date: string | null; end_date: string | null; notes: string | null }
const C_BLANK = { name: "", channel: "google_ads", status: "active", spend: "", leads: "", start_date: "", end_date: "", notes: "" };

function Marketing() {
  const { items, loading, create, remove } = useCollection<Campaign>("campaigns");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(C_BLANK);
  const [busy, setBusy] = useState(false);

  const totals = useMemo(() => ({
    spend: items.reduce((a, c) => a + (c.spend_cents ?? 0), 0),
    leads: items.reduce((a, c) => a + (c.leads ?? 0), 0),
  }), [items]);
  const cpl = totals.leads ? Math.round(totals.spend / totals.leads) : 0;

  async function save() {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await create({
        name: form.name, channel: form.channel, status: form.status,
        spend_cents: Math.round(parseFloat(form.spend || "0") * 100), leads: parseInt(form.leads || "0", 10),
        start_date: form.start_date, end_date: form.end_date, notes: form.notes,
      });
      setForm(C_BLANK); setOpen(false);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatTile label="Total spend" value={money(totals.spend)} />
        <StatTile label="Leads" value={totals.leads} tone="brand" />
        <StatTile label="Cost / lead" value={cpl ? money(cpl) : "—"} />
      </div>
      <div className="mb-4 flex justify-end"><Button onClick={() => { setForm(C_BLANK); setOpen(true); }}>+ Add campaign</Button></div>
      {loading ? <p className="text-sm text-chrome-400">Loading…</p> : items.length === 0 ? (
        <EmptyState title="No campaigns yet" hint="Track Google Ads, LSA, Instagram, and Facebook spend + leads. Live metric sync comes later." action={<Button onClick={() => setOpen(true)}>+ Add campaign</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((c) => (
            <div key={c.id} className="group rounded-2xl bg-white p-4 shadow-sm ring-1 ring-steel-200">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-graphite-950">{c.name}</div>
                  <div className="mt-1 flex gap-1.5">
                    <Tag color={colorOf(CAMPAIGN_CHANNELS, c.channel)}>{labelOf(CAMPAIGN_CHANNELS, c.channel)}</Tag>
                    <Tag color={colorOf(CAMPAIGN_STATUS, c.status)}>{labelOf(CAMPAIGN_STATUS, c.status)}</Tag>
                  </div>
                </div>
                <div className="opacity-0 transition group-hover:opacity-100"><DeleteButton onClick={() => remove(c.id)} /></div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div><div className="font-display text-lg text-graphite-950">{money(c.spend_cents)}</div><div className="text-[10px] uppercase tracking-wide text-chrome-400">Spend</div></div>
                <div><div className="font-display text-lg text-graphite-950">{c.leads}</div><div className="text-[10px] uppercase tracking-wide text-chrome-400">Leads</div></div>
                <div><div className="font-display text-lg text-graphite-950">{c.leads ? money(Math.round(c.spend_cents / c.leads)) : "—"}</div><div className="text-[10px] uppercase tracking-wide text-chrome-400">CPL</div></div>
              </div>
              {(c.start_date || c.notes) && <div className="mt-2 text-xs text-chrome-400">{[c.start_date && `${fmtDate(c.start_date)}${c.end_date ? "–" + fmtDate(c.end_date) : ""}`, c.notes].filter(Boolean).join(" · ")}</div>}
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add campaign"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add"}</Button></>}>
        <div className="space-y-3">
          <Field label="Campaign name"><Input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Miami LSA — July" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Channel"><Select options={CAMPAIGN_CHANNELS} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} /></Field>
            <Field label="Status"><Select options={CAMPAIGN_STATUS} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Spend ($)"><Input type="number" min="0" step="0.01" value={form.spend} onChange={(e) => setForm({ ...form, spend: e.target.value })} /></Field>
            <Field label="Leads"><Input type="number" min="0" value={form.leads} onChange={(e) => setForm({ ...form, leads: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start"><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
            <Field label="End"><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

/* ---------------- Content Calendar ---------------- */
interface Content extends Row { title: string; channel: string; body: string | null; scheduled_for: string | null; status: string; media_key: string | null }
const CT_BLANK = { title: "", channel: "instagram", body: "", scheduled_for: "", status: "draft", media_key: "" };

function ContentCalendar() {
  const { items, loading, create, update, remove } = useCollection<Content>("content");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(CT_BLANK);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(() => [...items].sort((a, b) => (b.scheduled_for ?? "").localeCompare(a.scheduled_for ?? "")), [items]);

  async function upload(file: File) {
    setUploading(true); setUploadErr("");
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/media", { method: "POST", credentials: "include", body: fd });
      if (res.status === 503) { setUploadErr("File storage isn't set up yet — you can still save with a title + notes."); return; }
      if (!res.ok) { setUploadErr("Upload failed."); return; }
      const { key } = (await res.json()) as { key: string };
      setForm((f) => ({ ...f, media_key: key }));
    } catch { setUploadErr("Upload failed."); }
    finally { setUploading(false); }
  }

  async function save() {
    if (!form.title.trim()) return;
    setBusy(true);
    try { await create(form); setForm(CT_BLANK); setOpen(false); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => { setForm(CT_BLANK); setUploadErr(""); setOpen(true); }}>+ Schedule content</Button></div>
      {loading ? <p className="text-sm text-chrome-400">Loading…</p> : sorted.length === 0 ? (
        <EmptyState title="No content scheduled" hint="Plan posts across Instagram, Facebook, TikTok, and more — draft, schedule, publish." action={<Button onClick={() => setOpen(true)}>+ Schedule content</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((ct) => (
            <div key={ct.id} className="group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-steel-200">
              {ct.media_key
                ? <img src={`/api/media/${ct.media_key}`} alt="" className="h-32 w-full bg-steel-100 object-cover" />
                : <div className="flex h-32 w-full items-center justify-center bg-gradient-to-br from-steel-100 to-steel-200 text-chrome-300"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5" /><circle cx="9" cy="9" r="1.5" /></svg></div>}
              <div className="p-3">
                <div className="flex items-center gap-1.5">
                  <Tag color={colorOf(CONTENT_CHANNELS, ct.channel)}>{labelOf(CONTENT_CHANNELS, ct.channel)}</Tag>
                  <select value={ct.status} onChange={(e) => update(ct.id, { status: e.target.value })}
                    className="ml-auto h-7 rounded-md border border-steel-200 bg-white px-1.5 text-xs outline-none focus:border-red-400">
                    {CONTENT_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div className="mt-2 font-medium text-graphite-950">{ct.title}</div>
                {ct.body && <div className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{ct.body}</div>}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-chrome-400">{ct.scheduled_for ? fmtDate(ct.scheduled_for) : "Unscheduled"}</span>
                  <div className="opacity-0 transition group-hover:opacity-100"><DeleteButton onClick={() => remove(ct.id)} /></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Schedule content"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy || uploading}>{busy ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-3">
          <Field label="Title"><Input value={form.title} autoFocus onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Before/after ceramic reel" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Channel"><Select options={CONTENT_CHANNELS} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} /></Field>
            <Field label="Status"><Select options={CONTENT_STATUS} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} /></Field>
          </div>
          <Field label="Publish date"><Input type="date" value={form.scheduled_for} onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })} /></Field>
          <Field label="Caption / notes"><Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <Field label="Media (optional)">
            <input ref={fileRef} type="file" accept="image/*,video/mp4,application/pdf" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-steel-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-steel-200" />
            {uploading && <span className="mt-1 block text-xs text-chrome-400">Uploading…</span>}
            {form.media_key && !uploading && <span className="mt-1 block text-xs text-emerald-600">Attached ✓</span>}
            {uploadErr && <span className="mt-1 block text-xs text-amber-600">{uploadErr}</span>}
          </Field>
        </div>
      </Modal>
    </>
  );
}

export default function GTM() {
  const [tab, setTab] = useState("overview");
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <PageHeader eyebrow="Growth" title="Go-To-Market" subtitle="Alignment, prospecting, marketing, and content — the growth engine in one place." />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "overview" && <Overview />}
      {tab === "prospecting" && <Prospecting />}
      {tab === "marketing" && <Marketing />}
      {tab === "content" && <ContentCalendar />}
    </div>
  );
}
