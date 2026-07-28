import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { api } from "../api";
import { fullName, type Contact, type Stage } from "../types";
import { STAGE_META } from "../lib/stages";
import { PageHeader } from "../components/ui";

type Board = Record<Stage, Contact[]>;
const empty = (): Board => ({ new: [], contacted: [], quoted: [], scheduled: [], customer: [], lost: [] });

const STAGE_DOT: Record<Stage, string> = {
  new: "bg-neutral-400", contacted: "bg-sky-500", quoted: "bg-amber-500",
  scheduled: "bg-violet-500", customer: "bg-emerald-500", lost: "bg-rose-500",
};

function Card({ c }: { c: Contact }) {
  return (
    <Link to={`/contacts/${c.id}`} className="block rounded-lg bg-white p-2.5 shadow-sm ring-1 ring-steel-200 transition hover:ring-red-200">
      <div className="truncate text-sm font-medium text-graphite-950">{fullName(c)}</div>
      {c.source && <div className="truncate text-[11px] text-chrome-400">{c.source}</div>}
    </Link>
  );
}

function DraggableCard({ c }: { c: Contact }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: c.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, opacity: isDragging ? 0.5 : 1 } : undefined;
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="touch-none">
      <Card c={c} />
    </div>
  );
}

function Column({ stage, items, total }: { stage: Stage; items: Contact[]; total: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const meta = STAGE_META.find((m) => m.key === stage)!;
  const more = total - items.length;
  return (
    <div ref={setNodeRef} className={`flex w-60 shrink-0 flex-col gap-1.5 rounded-xl p-2 ring-1 transition ${isOver ? "bg-red-50 ring-red-200" : "bg-steel-100 ring-steel-200"}`}>
      <div className="flex items-center gap-2 px-1.5 py-1">
        <span className={`h-2 w-2 rounded-full ${STAGE_DOT[stage]}`} />
        <span className="text-xs font-semibold uppercase tracking-wide text-graphite-800">{meta.label}</span>
        <span className="ml-auto rounded-full bg-white px-1.5 text-xs font-medium text-chrome-400 ring-1 ring-steel-200">{total}</span>
      </div>
      {items.map((c) => <DraggableCard key={c.id} c={c} />)}
      {items.length === 0 && <div className="px-1.5 py-3 text-center text-[11px] text-chrome-300">Empty</div>}
      {more > 0 && <div className="px-1.5 py-2 text-center text-[11px] text-chrome-400">+{more} more — <Link to={`/contacts?stage=${stage}`} className="font-medium text-red-600 hover:underline">view all</Link></div>}
    </div>
  );
}

const PER_COLUMN = 200; // matches the contacts API hard cap

export default function Pipeline() {
  const [board, setBoard] = useState<Board>(empty());
  const [totals, setTotals] = useState<Record<Stage, number>>(() => ({ new: 0, contacted: 0, quoted: 0, scheduled: 0, customer: 0, lost: 0 }));
  const [mobileStage, setMobileStage] = useState<Stage>("new");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(() => {
    Promise.all(STAGE_META.map((m) =>
      api<{ items: Contact[]; total: number }>(`/api/contacts?stage=${m.key}&limit=${PER_COLUMN}`).then((r) => [m.key, r.items, r.total] as const)
    )).then((triples) => {
      const b = empty();
      const t = { new: 0, contacted: 0, quoted: 0, scheduled: 0, customer: 0, lost: 0 } as Record<Stage, number>;
      for (const [k, items, total] of triples) { b[k] = items; t[k] = total; }
      setBoard(b);
      setTotals(t);
    }).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function move(contactId: string, from: Stage, to: Stage) {
    if (from === to) return;
    setBoard((b) => {
      const card = b[from].find((c) => c.id === contactId);
      if (!card) return b;
      return { ...b, [from]: b[from].filter((c) => c.id !== contactId), [to]: [{ ...card, stage: to }, ...b[to]] };
    });
    setTotals((t) => ({ ...t, [from]: Math.max(0, t[from] - 1), [to]: t[to] + 1 }));
    try {
      await api(`/api/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify({ stage: to }) });
    } catch {
      load(); // revert to server truth on failure
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const to = e.over?.id as Stage | undefined;
    const contactId = e.active.id as string;
    if (!to) return;
    const from = (Object.keys(board) as Stage[]).find((s) => board[s].some((c) => c.id === contactId));
    if (from) move(contactId, from, to);
  }

  return (
    <div className="p-4 md:p-8">
      <PageHeader eyebrow="Growth" title="Pipeline" subtitle="Drag leads across stages. Compact board for fast scanning." />

      {/* Mobile: segmented switcher + tap-to-move */}
      <div className="md:hidden">
        <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
          {STAGE_META.map((m) => (
            <button key={m.key} onClick={() => setMobileStage(m.key)}
              className={`whitespace-nowrap rounded-full px-3 py-2 text-sm ${mobileStage === m.key ? "bg-red-600 text-white" : "bg-neutral-200 text-neutral-700"}`}>
              {m.label} <span className="opacity-70">{totals[m.key]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {board[mobileStage].map((c) => (
            <div key={c.id} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <Link to={`/contacts/${c.id}`} className="min-w-0"><div className="truncate font-medium">{fullName(c)}</div><div className="truncate text-xs text-neutral-500">{c.source ?? "—"}</div></Link>
                <select value={c.stage} onChange={(e) => move(c.id, c.stage, e.target.value as Stage)}
                  className="min-h-[44px] rounded-md border border-neutral-300 px-2 text-sm">
                  {STAGE_META.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
            </div>
          ))}
          {board[mobileStage].length === 0 && <p className="text-sm text-neutral-500">No one here yet.</p>}
        </div>
      </div>

      {/* Desktop: draggable columns */}
      <div className="hidden md:block">
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {STAGE_META.map((m) => <Column key={m.key} stage={m.key} items={board[m.key]} total={totals[m.key]} />)}
          </div>
        </DndContext>
      </div>
    </div>
  );
}
