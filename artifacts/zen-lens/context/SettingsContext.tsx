import React, { createContext, useContext, useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  Settings,
  loadSettings,
  saveSettings,
} from "@/utils/storage";

interface SettingsContextType {
  settings: Settings;
  updateSettings: (partial: Partial<Settings>) => void;
  isLoaded: boolean;
}

const SettingsContext = createContext<SettingsContextType>({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
  isLoaded: false,
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setIsLoaded(true);
    });
  }, []);

  function updateSettings(partial: Partial<Settings>) {
    const next = { ...settings, ...partial };
    setSettings(next);
    saveSettings(next);
  }

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, isLoaded }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
