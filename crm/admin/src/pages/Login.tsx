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
    <div className="min-h-screen flex items-center justify-center bg-neutral-950">
      <form onSubmit={submit} className="w-80 space-y-4 rounded-xl bg-neutral-900 p-8">
        <h1 className="text-xl font-semibold text-white">BH CRM</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full rounded-md bg-neutral-800 px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-red-600"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-md bg-red-600 py-2 font-medium text-white hover:bg-red-500 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
