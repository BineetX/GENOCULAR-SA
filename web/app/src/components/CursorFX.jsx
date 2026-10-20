import React, { useEffect } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

const CursorFX = () => {
  const x = useMotionValue(-9999);
  const y = useMotionValue(-9999);
  const springX = useSpring(x, { stiffness: 350, damping: 40, mass: 0.5 });
  const springY = useSpring(y, { stiffness: 350, damping: 40, mass: 0.5 });

  useEffect(() => {
    const onMove = (e) => {
      x.set(e.clientX);
      y.set(e.clientY);
      document.documentElement.style.setProperty("--mx", `${e.clientX}px`);
      document.documentElement.style.setProperty("--my", `${e.clientY}px`);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [x, y]);

  return (
    <>
      {/* soft spotlight */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed -translate-x-1/2 -translate-y-1/2 z-[30] rounded-full"
        style={{
          left: springX,
          top: springY,
          width: "36vmax",
          height: "36vmax",
          background:
            "radial-gradient(closest-side, rgba(56,189,248,0.13), rgba(56,189,248,0.06) 40%, transparent 65%)",
          filter: "blur(8px)",
          mixBlendMode: "screen",
        }}
      />
      {/* thin ring */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed -translate-x-1/2 -translate-y-1/2 z-[31] rounded-full border"
        style={{
          left: springX,
          top: springY,
          width: 18,
          height: 18,
          borderColor: "rgba(56,189,248,0.65)",
          boxShadow: "0 0 20px rgba(56,189,248,0.4)",
        }}
      />
    </>
  );
};

export default CursorFX;
