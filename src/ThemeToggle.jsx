import React, { useEffect, useState } from "react";

const THEME_KEY = "physics-marks:theme";
export function initialTheme() {
  try {
    const saved = globalThis.localStorage?.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* The switch still works when storage is unavailable. */ }
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark" : "light";
}
// Apply before React renders to reduce a light flash on a dark preference.
if (typeof document !== "undefined") document.documentElement.dataset.theme = initialTheme();

export default function ThemeToggle() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* Optional persistence. */ }
  }, [theme]);
  return <button type="button" className="theme-toggle" aria-label="Dark mode" aria-pressed={theme === "dark"}
    title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    onClick={() => setTheme((previous) => previous === "dark" ? "light" : "dark")}>
    {theme === "dark" ? "Light mode" : "Dark mode"}
  </button>;
}
