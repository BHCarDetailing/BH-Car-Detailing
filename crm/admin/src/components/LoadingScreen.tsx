/* Branded boot screen. Signature moment: a "polish shine" buffs across the
   logo — like wiping down a freshly detailed panel — over a graphite backdrop. */
export default function LoadingScreen({ label = "Loading" }: { label?: string }) {
  return (
    <div className="bh-bg fixed inset-0 z-[100] grid place-items-center">
      <div className="relative z-10 flex flex-col items-center gap-6">
        <div className="bh-logo-in">
          <div className="bh-shine relative overflow-hidden">
            <img src="/brand/logo-light.png" alt="BH Car Detailing" className="bh-float h-24 w-auto drop-shadow-[0_8px_30px_rgba(200,16,46,0.35)]" />
          </div>
        </div>
        <div className="text-center">
          <div className="font-display text-xl tracking-wide text-white">BH Car Details</div>
          <div className="eyebrow text-[10px] text-chrome-400">Operating System</div>
        </div>
        <div className="relative h-1 w-40 overflow-hidden rounded-full bg-white/10">
          <div className="absolute inset-y-0 w-1/2 rounded-full bg-gradient-to-r from-transparent via-red-500 to-transparent" style={{ animation: "bh-sweep 1.15s ease-in-out infinite" }} />
        </div>
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}
