import React, { createContext, useContext, useMemo, useState } from "react";

const GuidedTourContext = createContext(null);

const TOUR_STEPS = ["analysis", "readMode", "jobName", "upload", "submit"];

export const guidedTourSteps = TOUR_STEPS;

export function GuidedTourProvider({ children }) {
  const [state, setState] = useState({
    active: false,
    step: "analysis",
    analysisType: "",
    readMode: "",
  });

  const api = useMemo(() => {
    const stepIndex = () => Math.max(0, TOUR_STEPS.indexOf(state.step));

    return {
      ...state,
      start() {
        setState({
          active: true,
          step: "analysis",
          analysisType: "wgs",
          readMode: "short",
        });
      },
      stop() {
        setState(prev => ({ ...prev, active: false }));
      },
      next() {
        setState(prev => {
          const currentIndex = Math.max(0, TOUR_STEPS.indexOf(prev.step));
          const nextStep = TOUR_STEPS[Math.min(TOUR_STEPS.length - 1, currentIndex + 1)];
          return { ...prev, step: nextStep };
        });
      },
      back() {
        setState(prev => {
          const currentIndex = Math.max(0, TOUR_STEPS.indexOf(prev.step));
          const nextStep = TOUR_STEPS[Math.max(0, currentIndex - 1)];
          return { ...prev, step: nextStep };
        });
      },
      goTo(step) {
        if (!TOUR_STEPS.includes(step)) return;
        setState(prev => ({ ...prev, active: true, step }));
      },
      chooseAnalysis(analysisType) {
        setState(prev => ({ ...prev, analysisType }));
      },
      chooseReadMode(readMode) {
        setState(prev => ({ ...prev, readMode }));
      },
      isFirstStep: stepIndex() === 0,
      isLastStep: stepIndex() === TOUR_STEPS.length - 1,
      stepNumber: stepIndex() + 1,
      totalSteps: TOUR_STEPS.length,
    };
  }, [state]);

  return (
    <GuidedTourContext.Provider value={api}>
      {children}
    </GuidedTourContext.Provider>
  );
}

export function useGuidedTour() {
  const value = useContext(GuidedTourContext);
  if (!value) {
    throw new Error("useGuidedTour must be used inside GuidedTourProvider");
  }
  return value;
}
