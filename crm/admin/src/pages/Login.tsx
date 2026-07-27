import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      nav("/dashboard");
    } catch {
      setError("Wrong password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bh-bg min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="relative z-10 w-80 space-y-4 rounded-2xl border border-white/10 bg-graphite-900/80 p-8 shadow-2xl backdrop-blur-xl bh-gloss">
        <div className="flex flex-col items-center gap-3 pb-2">
          <div className="bh-shine relative overflow-hidden">
            <img src="/brand/logo-light.png" alt="BH Car Detailing" className="h-16 w-auto" />
          </div>
          <div className="text-center">
            <div className="font-display text-lg tracking-wide text-white">BH CRM</div>
            <div className="eyebrow text-[9px] text-chrome-400">Operating System</div>
          </div>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-white placeholder-chrome-400 outline-none focus:border-red-500/50 focus:ring-2 focus:ring-red-600/30"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-gradient-to-b from-red-500 to-red-600 py-2.5 font-medium text-white shadow-sm shadow-red-600/25 ring-1 ring-inset ring-white/10 hover:from-red-500 hover:to-red-500 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
