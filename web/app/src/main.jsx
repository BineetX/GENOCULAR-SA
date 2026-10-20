import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";
import { AuthProvider } from "./auth/AuthProvider.jsx";
import { NavPrefsProvider } from "./lib/NavPrefsContext.jsx";
import { GuidedTourProvider } from "./lib/GuidedTourContext.jsx";
import { ThemeProvider } from "./lib/ThemeContext.jsx";

import { FontSizeProvider } from "./lib/FontSizeContext.jsx";

try {
  const storedTheme = JSON.parse(localStorage.getItem("gv:theme"));
  if (storedTheme === "dark") {
    document.documentElement.classList.add("dark", "genocular-dark");
    document.documentElement.dataset.theme = "dark";
  }
} catch {
  // ignore blocked or malformed localStorage
}

try {
  const storedFontSize = JSON.parse(localStorage.getItem("gv:fontSize"));
  if (storedFontSize === "xsmall") document.documentElement.style.fontSize = "12px";
  if (storedFontSize === "small") document.documentElement.style.fontSize = "14px";
  if (storedFontSize === "large") document.documentElement.style.fontSize = "18px";
  if (storedFontSize === "xlarge") document.documentElement.style.fontSize = "20px";
} catch {
  // ignore blocked or malformed localStorage
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <FontSizeProvider>
            <NavPrefsProvider>
              <GuidedTourProvider>
                <App />
              </GuidedTourProvider>
            </NavPrefsProvider>
          </FontSizeProvider>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
