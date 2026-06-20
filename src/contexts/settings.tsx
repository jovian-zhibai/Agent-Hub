"use client";
import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Theme = "dark" | "light";
type FontSize = "sm" | "md" | "lg";

interface Settings {
  theme: Theme;
  fontSize: FontSize;
}

interface SettingsContextType {
  settings: Settings;
  setTheme: (theme: Theme) => void;
  setFontSize: (size: FontSize) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>({ theme: "dark", fontSize: "md" });

  // 初始化：从 localStorage 读取
  useEffect(() => {
    const stored = localStorage.getItem("agent_hub_settings");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSettings({ theme: parsed.theme || "dark", fontSize: parsed.fontSize || "md" });
      } catch {
        // ignore invalid JSON
      }
    }
  }, []);

  // 主题变化时同步到 html 元素
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", settings.theme);
    root.classList.remove("dark", "light");
    root.classList.add(settings.theme);
    localStorage.setItem("agent_hub_settings", JSON.stringify(settings));
  }, [settings]);

  // 字体变化时同步到 html
  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = settings.fontSize === "sm" ? "14px" : settings.fontSize === "lg" ? "18px" : "16px";
  }, [settings.fontSize]);

  const setTheme = (theme: Theme) => setSettings(prev => ({ ...prev, theme }));
  const setFontSize = (size: FontSize) => setSettings(prev => ({ ...prev, fontSize: size }));

  return (
    <SettingsContext.Provider value={{ settings, setTheme, setFontSize }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}