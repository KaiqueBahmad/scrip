import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { en } from './en';
import { pt } from './pt';

export const LANG_STORAGE_KEY = 'scrip.lang';

function detectLanguage(): 'pt' | 'en' {
  const stored = localStorage.getItem(LANG_STORAGE_KEY);
  if (stored === 'pt' || stored === 'en') return stored;
  return 'en';
}

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    pt: { translation: pt },
  },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: 'pt' | 'en'): void {
  localStorage.setItem(LANG_STORAGE_KEY, lang);
  void i18next.changeLanguage(lang);
}

export default i18next;
