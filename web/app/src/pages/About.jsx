import React from "react";
import { motion as Motion } from "framer-motion";
import {
  Sparkles,
  Users,
  BookOpen,
  FileDown,
  Mail,
} from "lucide-react";
import GenocularLogo from "../components/GenocularLogo.jsx";

export default function About() {
  const team = [
    {
      name: "Dr. Rashmi Rekha Samal",
      role: "Development of the WGS and Metagenomics Execution Pipelines",
      email: "rashmirekhasamal11@gmail.com",
    },
    {
      name: "Bineet Kumar Mohanta",
      role: "Development & Deployment of the Server (Backend and Frontend) Architecture",
      email: "bineetkumarmohanta@gmail.com",
      additionalEmails: ["mail@bineet.dev"],
      link: "https://bineet.dev/",
    },
    {
      name: "Dr. Anshuman Dixit",
      role: "Principal Investigator",
      email: "anshumandixit@gmail.com",
    },
    {
      name: "Dr. Debasis Dash",
      role: "Director, Infrastructure",
      email: "ddash@ils.res.in",
    },
  ];

  const quickSteps = [
    {
      title: "Prepare inputs",
      desc: "Paired-end FASTQ files (R1/R2) with clean filenames.",
    },
    {
      title: "Upload & configure",
      desc: "Add a sample ID and optional metadata, then start the run.",
    },
    {
      title: "Monitor progress",
      desc: "Track QC and assembly steps as the pipeline executes.",
    },
    {
      title: "Explore results",
      desc: "Inspect outputs, download reports, and visualize genomes.",
    },
  ];

  const fadeUp = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
  };

  return (
    <div className="genocular-about min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 dark:text-slate-100">
      {/* Page header */}
      <div className="border-b border-slate-200/70 dark:border-slate-800/70 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl">
        <div className="flex w-full flex-col items-start justify-between gap-5 px-4 py-8 sm:px-8 md:flex-row md:items-center lg:px-14 xl:px-20">
          <div className="min-w-0">
            <h1 className="genocular-page-title truncate">
              About GENOCULAR
            </h1>
            <p className="genocular-page-subtitle truncate">
              Team &nbsp;•&nbsp; Usage guide &nbsp;•&nbsp; Documentation
            </p>
          </div>
          <div
            className="genocular-institutional-lockup flex max-w-full flex-col items-start gap-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 shadow-sm min-[520px]:flex-row min-[520px]:items-center"
            role="img"
            aria-label="GENOCULAR by BRIC-Institute of Life Sciences"
          >
            <span className="flex items-center gap-1.5" aria-hidden="true">
              <GenocularLogo className="h-8 w-8 sm:h-9 sm:w-9" priority />
              <span className="text-xl font-semibold tracking-[-0.035em] text-slate-950 dark:text-white sm:text-2xl">
                GENOCULAR
              </span>
            </span>
            <span aria-hidden className="text-xs font-medium lowercase text-slate-500">by</span>
            <img
              src="/ILS_logo.png"
              alt=""
              aria-hidden="true"
              draggable="false"
              decoding="async"
              className="translate-y-0.5 h-6 w-auto max-w-[calc(100vw-7.5rem)] object-contain sm:h-7 sm:max-w-[14rem] dark:hidden"
            />
            <img
              src="/ILS_logo_dark.png"
              alt=""
              aria-hidden="true"
              draggable="false"
              decoding="async"
              className="translate-y-0.5 h-6 w-auto max-w-[calc(100vw-7.5rem)] object-contain sm:h-7 sm:max-w-[14rem] hidden dark:block"
            />
          </div>
        </div>
      </div>

      <div className="w-full">
        <div className="w-full px-4 py-8 sm:px-8 lg:px-14 xl:px-20">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[330px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)] xl:gap-7">

            {/* LEFT: sticky team card */}
            <Motion.aside
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="h-fit"
            >
              <div className="lg:sticky lg:top-24">
                <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white/90 dark:bg-slate-900/90 p-4 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.38)] ring-1 ring-slate-900/[0.02] dark:ring-white/[0.02] sm:p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-600 to-cyan-500 text-white shadow-md shadow-sky-500/20">
                      <Users className="h-4 w-4" />
                    </div>
                    <div>
                      <h2 className="genocular-section-title">Team</h2>
                      <p className="mt-0.5 text-[10px] font-medium text-slate-500">Core contributors & leadership</p>
                    </div>
                  </div>

                  <ul className="space-y-2.5">
                    {team.map((m) => (
                      <li key={m.email} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 px-3.5 py-3 transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-sky-200 dark:hover:border-sky-800 hover:shadow-sm">
                        <div className="text-[15px] font-semibold leading-5 tracking-[-0.01em] text-slate-900 dark:text-slate-100">
                          {m.link ? (
                            <a
                              href={m.link}
                              target="_blank"
                              rel="noreferrer"
                              className="no-underline transition-colors hover:text-sky-700 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
                              aria-label={`${m.name} — personal website`}
                            >
                              {m.name}
                            </a>
                          ) : (
                            m.name
                          )}
                        </div>
                        <div className="mt-1 text-[11px] leading-[1.5] text-slate-600 dark:text-slate-400">{m.role}</div>
                        <div className="mt-1.5 flex flex-col items-start gap-1">
                          {[m.email, ...(m.additionalEmails || [])].map((email) => (
                            <a
                              key={email}
                              href={`mailto:${email}`}
                              className="inline-flex items-center gap-1.5 text-[10px] font-medium text-slate-500 transition-colors hover:text-sky-700 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
                              aria-label={`Email ${m.name} at ${email}`}
                            >
                              <Mail className="h-3 w-3" />
                              {email}
                            </a>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 px-3.5 py-3 text-sm">
                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Institute</div>
                    <div className="mt-1 text-[12px] font-medium leading-5 text-slate-700 dark:text-slate-300">
                      Institute of Life Sciences (ILS), Bhubaneswar
                    </div>
                  </div>
                </div>
              </div>
            </Motion.aside>

            {/* RIGHT: scrollable guide content */}
            <Motion.main
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="min-h-[65vh]"
            >
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white/90 dark:bg-slate-900/90 p-5 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.38)] ring-1 ring-slate-900/[0.02] dark:ring-white/[0.02] sm:p-6">
                  <div className="mb-3 flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700 ring-1 ring-sky-100">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <h2 className="genocular-section-title">Overview</h2>
                  </div>
                  <p className="text-justify text-[12px] leading-5 text-slate-600 dark:text-slate-400">
                    Genocular is a unified, web-based analytical platform designed to streamline microbial isolate genomics and complex metagenome analyses from raw sequencing data to publication-ready biological insights. Developed for researchers without requiring specialized command-line expertise, the server provides automated, reproducible workflows compatible with short-read (Illumina), long-read (Oxford Nanopore, PacBio), and hybrid sequencing strategies. Genocular handles end-to-end processing—including adaptive quality control, host decontamination, de novo assembly, polishing, and standards-compliant MAG recovery (MIMAG criteria via CheckM2 and BUSCO)—alongside deep functional characterization. Users receive comprehensive downstream profiling for biosynthetic gene clusters (antiSMASH), carbohydrate-active enzymes (dbCAN), CRISPR-Cas systems, antimicrobial resistance determinants, and metabolic or biodegradation pathways, all compiled into interactive HTML reports and publication-quality visualizations. Powered by an automated Snakemake execution backend with fully encapsulated software environments, Genocular ensures robust, scalable, and reproducible data interpretation for microbial ecology, biotechnology discovery, and pathogen surveillance.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white/90 dark:bg-slate-900/90 p-5 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.38)] ring-1 ring-slate-900/[0.02] dark:ring-white/[0.02] sm:p-6">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700 ring-1 ring-sky-100">
                      <BookOpen className="h-4 w-4" />
                    </span>
                    <h2 className="genocular-section-title">Quick Start</h2>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {quickSteps.map((s, idx) => (
                      <div key={s.title} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/70 p-3.5 transition-[border-color,transform] hover:-translate-y-px hover:border-sky-200 dark:hover:border-sky-800">
                        <div className="flex items-center gap-2.5 text-[13px] font-bold">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 font-mono text-[10px] text-white shadow-sm">
                            {String(idx + 1).padStart(2, "0")}
                          </span>
                          {s.title}
                        </div>
                        <p className="mt-2 text-[11px] leading-5 text-slate-600 dark:text-slate-400">{s.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white/90 dark:bg-slate-900/90 p-5 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.38)] ring-1 ring-slate-900/[0.02] dark:ring-white/[0.02] sm:p-6">
                  <h2 className="genocular-section-title mb-3">FAQ</h2>
                  <div className="space-y-2">
                    <details className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 px-4 py-3 transition-colors open:border-sky-200 dark:open:border-sky-800 open:bg-sky-50/40 dark:open:bg-sky-900/40">
                      <summary className="cursor-pointer text-[13px] font-semibold text-slate-900 dark:text-slate-100 marker:text-slate-400">What inputs are supported?</summary>
                      <p className="mt-2 text-[11px] leading-5 text-slate-600 dark:text-slate-400">
                        Paired-end FASTQ files (R1/R2) and CGView JSON exports for visualization.
                      </p>
                    </details>
                    <details className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 px-4 py-3 transition-colors open:border-sky-200 dark:open:border-sky-800 open:bg-sky-50/40 dark:open:bg-sky-900/40">
                      <summary className="cursor-pointer text-[13px] font-semibold text-slate-900 dark:text-slate-100 marker:text-slate-400">How do I monitor my run?</summary>
                      <p className="mt-2 text-[11px] leading-5 text-slate-600 dark:text-slate-400">
                        Use the Jobs page to track status and download results when complete.
                      </p>
                    </details>
                    <details className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 px-4 py-3 transition-colors open:border-sky-200 dark:open:border-sky-800 open:bg-sky-50/40 dark:open:bg-sky-900/40">
                      <summary className="cursor-pointer text-[13px] font-semibold text-slate-900 dark:text-slate-100 marker:text-slate-400">Can I export results?</summary>
                      <p className="mt-2 text-[11px] leading-5 text-slate-600 dark:text-slate-400">
                        Yes — download PNG/SVG and full output bundles from the Jobs page.
                      </p>
                    </details>
                  </div>
                </div>

                <div className="genocular-about-resources rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-sky-50 via-white to-emerald-50 dark:from-sky-950 dark:via-slate-900 dark:to-emerald-950 p-5 shadow-[0_18px_45px_-34px_rgba(14,116,144,0.32)] ring-1 ring-slate-900/[0.02] dark:ring-white/[0.02] sm:p-6">
                  <div className="mb-2 flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-sky-700 shadow-sm ring-1 ring-sky-100">
                      <FileDown className="genocular-about-resources-icon h-4 w-4" />
                    </span>
                    <h2 className="genocular-section-title">Resources</h2>
                  </div>
                  <p className="mt-3 text-[12px] leading-5 text-slate-600">
                    Download the user guide for detailed instructions and best practices.
                  </p>
                  <div className="mt-4">
                    <a
                      href="/guides/genocular_user_guide.pdf"
                      download
                      className="genocular-about-download inline-flex h-10 items-center gap-2 rounded-xl bg-slate-900 dark:bg-white px-4 text-[12px] font-semibold text-white dark:text-slate-900 shadow-sm transition hover:-translate-y-px hover:bg-slate-800 dark:hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                      title="Download the full user guide (PDF)"
                    >
                      <FileDown className="h-4 w-4" />
                      Download Guide (PDF)
                    </a>
                  </div>
                </div>
              </div>
            </Motion.main>
          </div>
        </div>
      </div>
    </div>
  );
}
