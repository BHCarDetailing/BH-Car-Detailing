/* Branded boot / loading screen: animated backdrop, logo entrance + float,
   and an on-brand progress sweep. Used on app boot and as a route fallback. */
export default function LoadingScreen({ label = "Loading" }: { label?: string }) {
  return (
    <div className="bh-bg fixed inset-0 z-[100] grid place-items-center">
      <div className="relative z-10 flex flex-col items-center gap-6">
        <div className="bh-logo-in">
          <img src="/brand/logo.png" alt="BH Car Detailing" className="bh-float h-24 w-auto drop-shadow-[0_8px_30px_rgba(200,16,46,0.35)]" />
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold tracking-tight text-white">BH Car Details</div>
          <div className="text-xs uppercase tracking-[0.25em] text-neutral-400">Operating System</div>
        </div>
        <div className="relative h-1 w-40 overflow-hidden rounded-full bg-white/10">
          <div className="absolute inset-y-0 w-1/2 rounded-full bg-gradient-to-r from-transparent via-red-500 to-transparent" style={{ animation: "bh-sweep 1.15s ease-in-out infinite" }} />
        </div>
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}
