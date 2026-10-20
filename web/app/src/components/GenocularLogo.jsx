import React from "react";

export default function GenocularLogo({ className = "", priority = false }) {
  return (
    <>
      <img
        src="/genocular_logo.svg"
        alt=""
        aria-hidden="true"
        draggable="false"
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        className={`shrink-0 select-none object-contain dark:hidden ${className}`}
      />
      <img
        src="/genocular_logo_dark.svg"
        alt=""
        aria-hidden="true"
        draggable="false"
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        className={`shrink-0 select-none object-contain hidden dark:block ${className}`}
      />
    </>
  );
}
