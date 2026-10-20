import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase.js";
import { 
  Activity, 
  Database, 
  Server, 
  Cpu, 
  Clock, 
  FileJson, 
  Box,
  Play,
  CheckCircle2,
  ChevronRight
} from "lucide-react";

import pipelineSvg from "../assets/pipeline.svg";

// --- ANIMATION CONFIG ---
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (custom) => ({
    opacity: 1,
    y: 0,
    transition: { delay: custom * 0.1, duration: 0.5, ease: "easeOut" }
  })
};

// “light beams” configurations
const gridBeams = [
  { top: "18%", left: "5%", axis: "x", distance: 420, duration: 10, delay: 0.4 },
  { top: "58%", left: "12%", axis: "x", distance: 520, duration: 12, delay: 1.2 },
  { top: "28%", left: "85%", axis: "y", distance: -260, duration: 11, delay: 0.7 },
  { top: "76%", left: "78%", axis: "y", distance: -320, duration: 13, delay: 1.7 },
];

const LandingPage = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setCheckingAuth(false);
    });
    return () => unsub();
  }, []);

  const handleStartNow = () => {
    if (checkingAuth) return;
    if (user) navigate("/run");
    else navigate("/signin");
  };

  return (
    <div className="min-h-[calc(100vh-56px-40px)] bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-sky-100 selection:text-sky-900">
      <main className="flex-1 flex flex-col">
        
        {/* --- HERO SECTION --- */}
        <section className="relative overflow-hidden border-b border-slate-200 bg-slate-50/50 lg:min-h-[85vh] flex items-center">
          
          {/* Background: Tech Grid & Beams */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-40 -right-32 h-96 w-96 rounded-full bg-sky-100/80 blur-[100px] mix-blend-multiply" />
            <div className="absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-emerald-100/80 blur-[100px] mix-blend-multiply" />
            
            {/* Crisp Technical Grid */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_40%,transparent_100%)]" />

            {/* Moving Data Beams */}
            {gridBeams.map((beam, idx) => (
              <motion.span
                key={idx}
                className="absolute rounded-full bg-sky-500/40 blur-[1px]"
                style={{
                  top: beam.top,
                  left: beam.left,
                  width: beam.axis === "x" ? "120px" : "2px",
                  height: beam.axis === "x" ? "2px" : "120px",
                }}
                animate={
                  beam.axis === "x"
                    ? { x: [0, beam.distance], opacity: [0, 1, 0] }
                    : { y: [0, beam.distance], opacity: [0, 1, 0] }
                }
                transition={{
                  duration: beam.duration,
                  delay: beam.delay,
                  repeat: Infinity,
                  repeatDelay: 2,
                  ease: "linear",
                }}
              />
            ))}
          </div>

          <div className="relative w-full px-4 sm:px-8 lg:px-14 xl:px-20 py-12 lg:py-0">
            <div className="grid gap-12 lg:grid-cols-2 xl:grid-cols-[1.1fr_0.9fr] items-center">
              
              {/* LEFT: Copy & CTA */}
              <div className="space-y-8 z-10">
                
                {/* Badge Group */}
                <motion.div 
                  variants={fadeUp} custom={0} initial="hidden" animate="visible"
                  className="flex flex-wrap items-center gap-3"
                >
                  <div className="flex items-center gap-2 rounded-full bg-white border border-slate-200 px-3 py-1 shadow-sm">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    </div>
                    <span className="text-[11px] font-bold tracking-wider text-slate-600 uppercase">v2.0 Active</span>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-700 border border-sky-100">
                    <Server size={12} />
                    ILS On-Prem
                  </span>
                </motion.div>

                {/* Headlines */}
                <motion.div variants={fadeUp} custom={1} initial="hidden" animate="visible" className="space-y-4">
                  <h1 className="text-4xl sm:text-5xl xl:text-6xl font-bold tracking-tight text-slate-900 leading-[1.1]">
                    Automated Microbial <br/>
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-600 to-indigo-600">
                      Genomic Assembly
                    </span>
                  </h1>
                  <p className="text-base sm:text-lg text-slate-600 max-w-2xl leading-relaxed">
                    A fully containerized <strong>Snakemake</strong> workflow for paired-end WGS data. 
                    Generate publication-ready assemblies, annotations, and QC reports without managing dependencies.
                  </p>
                </motion.div>

                {/* Tech Stack Badges */}
                <motion.div 
                  variants={fadeUp} custom={2} initial="hidden" animate="visible"
                  className="flex flex-wrap items-center gap-2"
                >
                  {[
                    { label: "Snakemake", icon: Activity },
                    { label: "Apptainer", icon: Box },
                    { label: "MinIO Storage", icon: Database },
                    { label: "RHEL Core", icon: Cpu },
                  ].map((tag, i) => (
                    <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white/60 backdrop-blur-sm text-xs font-medium text-slate-600 shadow-sm">
                      <tag.icon size={12} className="text-sky-600" />
                      {tag.label}
                    </div>
                  ))}
                </motion.div>

                {/* CTA Area */}
                <motion.div variants={fadeUp} custom={3} initial="hidden" animate="visible" className="space-y-5 pt-2">
                  <div className="flex flex-wrap items-center gap-4">
                    <motion.button
                      onClick={handleStartNow}
                      disabled={checkingAuth}
                      whileHover={{ scale: 1.02, boxShadow: "0 20px 30px -10px rgba(14, 165, 233, 0.3)" }}
                      whileTap={{ scale: 0.98 }}
                      className="group relative inline-flex items-center gap-3 px-8 py-3.5 bg-slate-900 text-white rounded-full font-semibold text-sm shadow-xl hover:bg-slate-800 transition-all overflow-hidden"
                    >
                      {/* Sheen effect */}
                      <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent z-10" />
                      
                      <span className="relative z-20 flex items-center gap-2">
                         {checkingAuth ? "Connecting..." : "Start Analysis"}
                         <ChevronRight size={16} className="text-sky-400" />
                      </span>
                    </motion.button>
                    
                    <div className="text-xs text-slate-500 flex flex-col">
                      <span className="font-medium text-slate-700">
                        {user ? `Logged in as ${user.email}` : "Institutional Access Required"}
                      </span>
                      <span>Secure data processing within intranet.</span>
                    </div>
                  </div>
                </motion.div>

                {/* Feature Cards - Interactive Grid */}
                <motion.div 
                   variants={fadeUp} custom={4} initial="hidden" animate="visible"
                   className="grid grid-cols-2 gap-3 pt-4 max-w-lg"
                >
                  <FeatureCard 
                    icon={Clock} 
                    label="Fast Turnaround" 
                    val="2–3 Hrs" 
                    desc="Per sample runtime"
                  />
                   <FeatureCard 
                    icon={FileJson} 
                    label="Comprehensive" 
                    val="20+ Rules" 
                    desc="QC, Trim, Assemble, Annotate"
                  />
                </motion.div>
              </div>

              {/* RIGHT: Technical Visualization */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
                className="relative w-full max-w-xl justify-self-center lg:justify-self-end"
              >
                {/* Glow behind the card */}
                <div className="absolute -inset-4 bg-gradient-to-tr from-sky-100 via-emerald-50 to-indigo-50 rounded-[40px] blur-2xl opacity-80" />
                
                {/* The "Monitor" Card */}
                <div className="relative rounded-2xl border border-slate-200 bg-white shadow-[0_30px_60px_-12px_rgba(0,0,0,0.08)] overflow-hidden">
                  
                  {/* Window Header */}
                  <div className="h-10 bg-slate-50 border-b border-slate-100 flex items-center justify-between px-4">
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                      <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <Activity size={10} className="text-emerald-500" />
                      Pipeline_Monitor.exe
                    </div>
                  </div>

                  {/* The Schematic + Scanning Effect */}
                  <div className="relative p-6 bg-white min-h-[300px] flex items-center justify-center group cursor-default">
                    {/* Grid Background inside monitor */}
                    <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] opacity-50" />
                    
                    {/* The Schematic SVG */}
                    <div className="relative z-10 w-full transition-transform duration-500 group-hover:scale-[1.02]">
                      <img
                        src={pipelineSvg}
                        alt="Pipeline Schematic"
                        className="w-full h-auto drop-shadow-sm"
                      />
                      
                      {/* Scanning Laser Animation */}
                      <motion.div 
                        className="absolute top-0 bottom-0 w-[2px] bg-gradient-to-b from-transparent via-sky-400 to-transparent z-20 shadow-[0_0_15px_rgba(56,189,248,0.5)]"
                        initial={{ left: "0%" }}
                        animate={{ left: ["0%", "100%"] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      >
                         <div className="absolute top-0 right-0 bg-sky-500 text-[9px] text-white px-1 rounded-bl-md font-mono opacity-80">SCAN</div>
                      </motion.div>
                    </div>
                  </div>

                  {/* Monitor Footer/Console */}
                  <div className="bg-slate-50 border-t border-slate-100 p-3 text-[10px] font-mono text-slate-500 flex justify-between items-center">
                    <div className="flex gap-3">
                       <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"/> System Ready</span>
                       <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-sky-500"/> GPU Idle</span>
                    </div>
                    <div className="text-slate-400">RAM: 128GB Allocated</div>
                  </div>
                </div>

                {/* Floating "Success" Notification */}
                <motion.div 
                  className="absolute -right-6 bottom-12 bg-white border border-slate-100 p-3 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.06)] flex items-center gap-3 z-20"
                  animate={{ y: [0, -8, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                >
                  <div className="bg-emerald-50 p-2 rounded-lg text-emerald-600">
                    <CheckCircle2 size={20} />
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-400 uppercase">Last Job</div>
                    <div className="text-xs font-bold text-slate-700">Completed (Q30: 98%)</div>
                  </div>
                </motion.div>

              </motion.div>
            </div>
          </div>
        </section>

        {/* --- DETAILS SECTION --- */}
        <section className="w-full bg-white border-t border-slate-200 py-16">
          <div className="w-full px-4 sm:px-8 lg:px-14 xl:px-20">
            <div className="grid md:grid-cols-3 gap-10">
              <InfoColumn 
                title="What the pipeline does"
                text="Automatic trimming, assembly, annotation, QC, and report generation for bacterial genomes using a version-controlled Snakemake workflow."
              />
              <InfoColumn 
                title="What you get"
                text="Final FASTA assemblies, GFF annotations, MultiQC HTML reports, and downloadable results via secure, access-controlled MinIO links."
              />
              <InfoColumn 
                title="Who is this for"
                text="Wet-lab microbiologists, sequencing cores, and joint projects needing robust, standardized WGS pipelines without managing Linux environments."
              />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

// --- SUBCOMPONENTS ---

const FeatureCard = ({ icon: Icon, label, val, desc }) => (
  <motion.div 
    whileHover={{ y: -2, backgroundColor: "#f8fafc" }}
    className="p-3 rounded-xl border border-slate-200 bg-white transition-colors cursor-default"
  >
    <div className="flex items-center gap-2 mb-1 text-slate-500">
      <Icon size={14} />
      <span className="text-[10px] font-bold uppercase tracking-wide">{label}</span>
    </div>
    <div className="text-lg font-bold text-slate-900">{val}</div>
    <div className="text-[11px] text-slate-500 leading-tight">{desc}</div>
  </motion.div>
);

const InfoColumn = ({ title, text }) => (
  <div className="space-y-3 group">
    <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
      <div className="w-1 h-4 bg-sky-500 rounded-full group-hover:h-6 transition-all" />
      {title}
    </h2>
    <p className="text-sm text-slate-600 leading-relaxed">
      {text}
    </p>
  </div>
);

export default LandingPage;
