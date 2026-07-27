/* Branded boot screen: the logo floats in on a clean white chip over a
   graphite backdrop with the drifting brand-red glow. */
import { BrandLogo } from "./ui";

export default function LoadingScreen({ label = "Loading" }: { label?: string }) {
  return (
    <div className="bh-bg fixed inset-0 z-[100] grid place-items-center">
      <div className="relative z-10 flex flex-col items-center gap-6">
        <div className="bh-logo-in">
          <BrandLogo h="h-20" chip className="bh-float shadow-2xl shadow-red-600/20" />
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
