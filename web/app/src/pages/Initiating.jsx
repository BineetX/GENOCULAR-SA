import React, { useEffect } from "react";
import GenocularLogo from "../components/GenocularLogo.jsx";

const HOME_URL = import.meta.env.VITE_GENOCULAR_HOME_URL || "/";

export default function Initiating() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.location.replace(HOME_URL);
    }, 2200);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="relative grid min-h-screen overflow-hidden bg-[#071521] px-6 text-center text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_22%,rgba(14,165,233,0.22),transparent_34%),radial-gradient(circle_at_20%_80%,rgba(16,185,129,0.16),transparent_28%)]" />
      <div className="absolute left-1/2 top-1/2 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-white/[0.03] blur-3xl" />

      <section className="relative z-10 m-auto w-full max-w-3xl">
        <GenocularLogo className="mx-auto mb-9 h-24 w-24 drop-shadow-[0_0_34px_rgba(56,189,248,0.3)]" priority />

        <h1 className="m-0 bg-gradient-to-r from-white via-sky-100 to-emerald-100 bg-clip-text text-[clamp(3rem,9vw,6.5rem)] font-bold uppercase tracking-[0.14em] text-transparent">
          GENOCULAR
        </h1>

        <p className="mt-5 text-[clamp(1.35rem,3vw,2.2rem)] font-medium text-white/90">
          Initiating GENOCULAR...
        </p>

        <p className="mt-4 text-sm uppercase tracking-[0.32em] text-white/45">
          Microbial Genome Analysis Server
        </p>

        <div className="mx-auto mt-10 h-1.5 w-[min(28rem,76vw)] overflow-hidden rounded-full bg-white/15">
          <div className="h-full w-[42%] rounded-full bg-gradient-to-r from-sky-200 via-white to-emerald-200 shadow-[0_0_22px_rgba(255,255,255,0.45)] animate-[presentation-loader_1.1s_ease-in-out_infinite]" />
        </div>
      </section>
    </main>
  );
}
