
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { translations, Language } from '../services/translations';
import { api } from '../services/api';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>('uk');

  // Load language setting from DB on mount
  useEffect(() => {
    const loadLang = async () => {
      const settings = await api.settings.getSettings();
      if (settings && settings.ui_language) {
        setLanguageState(settings.ui_language);
      }
    };
    loadLang();
  }, []);

  const setLanguage = async (lang: Language) => {
    setLanguageState(lang);
    await api.settings.saveLanguage(lang); // We need to add this to API
  };

  // Helper to access nested object properties by string path (e.g., "dashboard.title")
  const t = (key: string): string => {
    const keys = key.split('.');
    let value: any = translations[language];
    
    for (const k of keys) {
      if (value && value[k]) {
        value = value[k];
      } else {
        // Fallback to English if key missing
        let fallback: any = translations['en'];
        for (const fk of keys) fallback = fallback?.[fk];
        return fallback || key;
      }
    }
    return value;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
