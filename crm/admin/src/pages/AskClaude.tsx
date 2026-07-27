import { useRef, useState, useEffect } from "react";
import { PageHeader } from "../components/ui";
import { api, ApiError } from "../api";

interface Msg { role: "user" | "assistant"; text: string }

const PRESETS = [
  "What should I focus on today?",
  "Draft a follow-up plan for my new leads.",
  "Give me 3 ideas to book more recurring detailing clients.",
  "Summarize this week and what needs attention.",
  "Which clients should I reach out to next?",
  "What KPIs am I likely behind on?",
];

export default function AskClaude() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history = msgs.map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const r = await api<{ text: string }>("/api/ai/ask", { method: "POST", body: JSON.stringify({ question: q, history }) });
      setMsgs((m) => [...m, { role: "assistant", text: r.text }]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setNotConfigured(true);
        setMsgs((m) => [...m, { role: "assistant", text: "AI isn't switched on yet. Add your Anthropic API key (wrangler secret ANTHROPIC_API_KEY) and I'll answer with live context from your CRM." }]);
      } else {
        setMsgs((m) => [...m, { role: "assistant", text: "Something went wrong reaching the assistant. Try again in a moment." }]);
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-3xl flex-col p-4 md:h-screen md:p-8">
      <PageHeader eyebrow="Tools" title="Ask Claude" subtitle="Your operations copilot — grounded in live CRM context." />

      {notConfigured && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          AI is dormant until an Anthropic key is set. Everything else here still works.
        </div>
      )}

      <div className="flex-1 overflow-y-auto rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-100">
        {msgs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-red-600">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9z" /></svg>
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-800">Ask about your business</p>
              <p className="mt-1 text-sm text-neutral-400">Pick a starter or type your own question.</p>
            </div>
            <div className="flex max-w-lg flex-wrap justify-center gap-2">
              {PRESETS.map((p) => (
                <button key={p} onClick={() => send(p)}
                  className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700">
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                  m.role === "user" ? "bg-red-600 text-white" : "bg-neutral-100 text-neutral-800"
                }`}>{m.text}</div>
              </div>
            ))}
            {busy && <div className="flex justify-start"><div className="rounded-2xl bg-neutral-100 px-4 py-2.5 text-sm text-neutral-400">Thinking…</div></div>}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="Ask anything about operations, follow-ups, planning…" rows={1}
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" />
        <button onClick={() => send(input)} disabled={busy || !input.trim()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-600 text-white hover:bg-red-500 disabled:opacity-50">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </div>
    </div>
  );
}
