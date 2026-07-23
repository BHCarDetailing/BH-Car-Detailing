import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { fullName, type SmsMessage } from "../types";

interface InboxRow {
  id: string;
  contact_id: string;
  body_text: string | null;
  direction: string;
  status: string;
  created_at: string;
  channel?: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  missed_unacked?: number;
  missed_texted?: number;
}

export default function Inbox() {
  const [items, setItems] = useState<InboxRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<InboxRow | null>(null);

  const loadInbox = useCallback(() => {
    api<{ items: InboxRow[] }>("/api/messages/inbox")
      .then((r) => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  useEffect(loadInbox, [loadInbox]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Conversation list */}
      <aside className={`${selected ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-neutral-200 bg-white md:w-80`}>
        <div className="border-b border-neutral-200 p-4">
          <h1 className="text-xl font-semibold">Inbox</h1>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loaded && items.length === 0 ? (
            <p className="p-4 text-sm text-neutral-500">No conversations yet. Texts, webchat messages, and missed calls all land here.</p>
          ) : (
            <ul className="divide-y">
              {items.map((m) => (
                <li key={m.id ?? m.contact_id}>
                  <button onClick={() => setSelected(m)} className={`flex w-full items-start justify-between gap-2 p-3 text-left hover:bg-neutral-50 ${selected?.contact_id === m.contact_id ? "bg-red-50" : ""}`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{fullName({ first_name: m.first_name, last_name: m.last_name })}</span>
                        {m.channel === "webchat" && <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600">webchat</span>}
                      </div>
                      {m.missed_unacked ? (
                        <span className="mt-0.5 inline-block rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-medium text-white">
                          {m.missed_texted ? "🔥 Missed call — auto-texted" : "Missed call — reply"}
                        </span>
                      ) : null}
                      <div className="truncate text-sm text-neutral-500">{m.direction === "inbound" ? "" : "You: "}{m.body_text ?? ""}</div>
                    </div>
                    <span className="shrink-0 text-[11px] text-neutral-400">{m.created_at ? new Date(m.created_at).toLocaleDateString() : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Thread */}
      <section className={`${selected ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col bg-neutral-50`}>
        {selected ? (
          <Thread row={selected} onBack={() => setSelected(null)} onSent={loadInbox} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">Pick a conversation to read and reply.</div>
        )}
      </section>
    </div>
  );
}

function Thread({ row, onBack, onSent }: { row: InboxRow; onBack: () => void; onSent: () => void }) {
  const [msgs, setMsgs] = useState<SmsMessage[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api<{ items: SmsMessage[] }>(`/api/messages?contact_id=${row.contact_id}`).then((r) => setMsgs(r.items)).catch(() => {});
  }, [row.contact_id]);
  useEffect(load, [load]);
  useEffect(() => { endRef.current?.scrollIntoView(); }, [msgs]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true); setNote("");
    try {
      const r = (await api("/api/messages", { method: "POST", body: JSON.stringify({ contact_id: row.contact_id, body: body.trim() }) })) as { status: string };
      setBody("");
      setNote(r.status === "sent" ? "" : r.status === "logged" ? "Saved — texting goes live once Twilio is connected." : `Status: ${r.status}`);
      load(); onSent();
    } catch (e) {
      setNote((e as { status?: number })?.status === 400 ? "This contact has no phone number." : "Couldn't send — try again.");
    } finally { setBusy(false); }
  }

  return (
    <>
      <header className="flex items-center gap-2 border-b border-neutral-200 bg-white p-3">
        <button onClick={onBack} className="rounded-md p-1 text-neutral-500 md:hidden" aria-label="Back">←</button>
        <div className="min-w-0">
          <Link to={`/contacts/${row.contact_id}`} className="font-medium hover:underline">{fullName({ first_name: row.first_name, last_name: row.last_name })}</Link>
          <div className="text-xs text-neutral-500">{row.phone ?? "no phone"}</div>
        </div>
        <Link to={`/contacts/${row.contact_id}`} className="ml-auto text-sm text-red-600 hover:underline">Open contact ↗</Link>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {msgs.length === 0 ? (
          <p className="text-center text-sm text-neutral-400">No messages in this thread yet.</p>
        ) : msgs.map((m) => {
          const out = m.direction === "outbound";
          return (
            <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${out ? "bg-red-600 text-white" : "bg-white text-neutral-900 shadow-sm"}`}>
                <div className="whitespace-pre-wrap break-words">{m.body_text}</div>
                <div className={`mt-0.5 text-[10px] ${out ? "text-red-100" : "text-neutral-400"}`}>
                  {m.channel === "webchat" ? "webchat · " : ""}{new Date(m.created_at).toLocaleString()}{out && m.status ? ` · ${m.status}` : ""}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="border-t border-neutral-200 bg-white p-3">
        {note && <div className="mb-2 text-xs text-neutral-500">{note}</div>}
        <div className="flex items-end gap-2">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={1} placeholder="Type a text…" className="min-h-[44px] flex-1 resize-none rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-600" />
          <button disabled={busy} className="min-h-[44px] shrink-0 rounded-md bg-red-600 px-4 text-sm text-white disabled:opacity-50">{busy ? "…" : "Send"}</button>
        </div>
      </form>
    </>
  );
}
