import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { fullName } from "../types";

interface InboxRow {
  id: string;
  contact_id: string;
  body_text: string | null;
  direction: string;
  status: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}

export default function Inbox() {
  const [items, setItems] = useState<InboxRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<{ items: InboxRow[] }>("/api/messages/inbox")
      .then((r) => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="p-4 md:p-8">
      <h1 className="mb-4 text-2xl font-semibold">Inbox</h1>
      {loaded && items.length === 0 ? (
        <p className="text-sm text-neutral-500">No text conversations yet. Texts you send from a contact — and replies once Twilio is live — show up here.</p>
      ) : (
        <ul className="divide-y rounded-xl bg-white shadow-sm">
          {items.map((m) => (
            <li key={m.id}>
              <Link to={`/contacts/${m.contact_id}`} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="font-medium">{fullName({ first_name: m.first_name, last_name: m.last_name })}</div>
                  <div className="truncate text-sm text-neutral-500">
                    {m.direction === "inbound" ? "" : "You: "}{m.body_text ?? ""}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-neutral-400">{new Date(m.created_at).toLocaleDateString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
