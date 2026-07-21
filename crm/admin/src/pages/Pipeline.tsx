import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { api } from "../api";
import { fullName, type Contact, type Stage } from "../types";
import { STAGE_META } from "../lib/stages";

type Board = Record<Stage, Contact[]>;
const empty = (): Board => ({ new: [], contacted: [], quoted: [], scheduled: [], customer: [], lost: [] });

function Card({ c }: { c: Contact }) {
  return (
    <Link to={`/contacts/${c.id}`} className="block rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="font-medium">{fullName(c)}</div>
      <div className="truncate text-xs text-neutral-500">{c.source ?? "—"}</div>
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

function Column({ stage, items }: { stage: Stage; items: Contact[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const meta = STAGE_META.find((m) => m.key === stage)!;
  return (
    <div ref={setNodeRef} className={`flex w-72 shrink-0 flex-col gap-2 rounded-xl p-2 ${isOver ? "bg-red-50" : "bg-neutral-100"}`}>
      <div className="px-1 text-sm font-semibold">{meta.label} <span className="text-neutral-400">{items.length}</span></div>
      {items.map((c) => <DraggableCard key={c.id} c={c} />)}
    </div>
  );
}

export default function Pipeline() {
  const [board, setBoard] = useState<Board>(empty());
  const [mobileStage, setMobileStage] = useState<Stage>("new");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(() => {
    Promise.all(STAGE_META.map((m) =>
      api<{ items: Contact[] }>(`/api/contacts?stage=${m.key}&limit=100`).then((r) => [m.key, r.items] as const)
    )).then((pairs) => {
      const b = empty();
      for (const [k, items] of pairs) b[k] = items;
      setBoard(b);
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
      <h1 className="mb-4 text-2xl font-semibold">Pipeline</h1>

      {/* Mobile: segmented switcher + tap-to-move */}
      <div className="md:hidden">
        <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
          {STAGE_META.map((m) => (
            <button key={m.key} onClick={() => setMobileStage(m.key)}
              className={`whitespace-nowrap rounded-full px-3 py-2 text-sm ${mobileStage === m.key ? "bg-red-600 text-white" : "bg-neutral-200 text-neutral-700"}`}>
              {m.label} <span className="opacity-70">{board[m.key].length}</span>
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
            {STAGE_META.map((m) => <Column key={m.key} stage={m.key} items={board[m.key]} />)}
          </div>
        </DndContext>
      </div>
    </div>
  );
}
