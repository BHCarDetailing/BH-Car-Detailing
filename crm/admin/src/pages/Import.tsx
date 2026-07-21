import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { parseContactsFile, type ParsedContact } from "../lib/vcard";

interface BulkResult { created: number; merged: number; errors: Array<{ index: number; error: string }> }

export default function Import() {
  const [parsed, setParsed] = useState<ParsedContact[] | null>(null);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null); setError("");
    try {
      const text = await file.text();
      const contacts = parseContactsFile(file.name, text);
      setFilename(file.name);
      setParsed(contacts);
      if (contacts.length === 0) setError("No contacts found in that file. Export from iPhone Contacts as a vCard (.vcf), or use a CSV with name/email/phone columns.");
    } catch {
      setError("Couldn't read that file.");
    }
  }

  async function runImport() {
    if (!parsed || parsed.length === 0) return;
    setBusy(true); setError("");
    const totals: BulkResult = { created: 0, merged: 0, errors: [] };
    try {
      for (let i = 0; i < parsed.length; i += 200) {
        const chunk = parsed.slice(i, i + 200);
        const r = (await api("/api/contacts/bulk", { method: "POST", body: JSON.stringify({ contacts: chunk }) })) as BulkResult;
        totals.created += r.created;
        totals.merged += r.merged;
        totals.errors.push(...r.errors);
      }
      setResult(totals);
      setParsed(null);
    } catch {
      setError("Import failed partway — re-run to finish (duplicates are skipped safely).");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-4 flex items-center gap-3">
        <Link to="/contacts" className="text-sm text-red-600 hover:underline">‹ Contacts</Link>
        <h1 className="text-2xl font-semibold">Import contacts</h1>
      </div>

      <div className="max-w-xl space-y-4">
        <div className="rounded-xl bg-white p-5 text-sm shadow-sm">
          <p className="mb-2 font-medium">From your iPhone</p>
          <ol className="list-decimal space-y-1 pl-5 text-neutral-600">
            <li>Open <strong>Contacts</strong>, tap a contact (or select several).</li>
            <li><strong>Share Contact</strong> → save/AirDrop the <code>.vcf</code> file to this device.</li>
            <li>Pick the file below. A CSV export works too.</li>
          </ol>
        </div>

        <input type="file" accept=".vcf,.csv,text/vcard,text/csv" onChange={onFile}
          className="block w-full text-sm file:mr-3 file:min-h-[44px] file:rounded-md file:border-0 file:bg-neutral-900 file:px-4 file:text-white" />

        {error && <p className="text-sm text-red-600">{error}</p>}

        {parsed && parsed.length > 0 && (
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="mb-3 text-sm"><strong>{parsed.length}</strong> contact{parsed.length === 1 ? "" : "s"} found in <span className="text-neutral-500">{filename}</span>. Duplicates (same phone or email) are merged, not doubled.</p>
            <ul className="mb-4 max-h-52 space-y-1 overflow-y-auto text-sm">
              {parsed.slice(0, 10).map((c, i) => (
                <li key={i} className="flex justify-between gap-2 border-b border-neutral-100 py-1">
                  <span className="truncate">{[c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)"}</span>
                  <span className="shrink-0 text-neutral-500">{c.phone ?? c.email ?? ""}</span>
                </li>
              ))}
              {parsed.length > 10 && <li className="py-1 text-neutral-400">…and {parsed.length - 10} more</li>}
            </ul>
            <button disabled={busy} onClick={runImport} className="min-h-[44px] rounded-md bg-red-600 px-5 text-sm text-white disabled:opacity-50">
              {busy ? "Importing…" : `Import ${parsed.length} contact${parsed.length === 1 ? "" : "s"}`}
            </button>
          </div>
        )}

        {result && (
          <div className="rounded-xl bg-green-50 p-5 text-sm text-green-900 shadow-sm">
            <p className="font-medium">Done.</p>
            <p>{result.created} new · {result.merged} merged into existing{result.errors.length ? ` · ${result.errors.length} skipped (no phone or email)` : ""}.</p>
            <Link to="/contacts" className="mt-2 inline-block text-red-600 hover:underline">View contacts ›</Link>
          </div>
        )}
      </div>
    </div>
  );
}
