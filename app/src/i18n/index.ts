// =============================================================================
// i18next configuration — static UI string localisation (Phase 4)
// =============================================================================
// Static strings (button labels, navigation, error messages, etc.) live here
// and are swapped at runtime when the user changes language via LanguageSwitcher.
// Entity data (ingredient names, menu names, etc.) is NOT handled here — that
// uses the separate translations JSONB + /api/translations system.
//
// Pattern:
//   import { useTranslation } from 'react-i18next'
//   const { t } = useTranslation()
//   <button>{t('common.save')}</button>
// =============================================================================

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en'
import fr from './locales/fr'
import es from './locales/es'
import de from './locales/de'
import it from './locales/it'
import nl from './locales/nl'
import pl from './locales/pl'
import pt from './locales/pt'
import hi from './locales/hi'

export const SUPPORTED_LANGUAGES = ['en', 'fr', 'es', 'de', 'it', 'nl', 'pl', 'pt', 'hi'] as const

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en, fr, es, de, it, nl, pl, pt, hi },
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'nav'],
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'mcogs-language',
      caches: ['localStorage'],
    },
    react: { useSuspense: false },
  })

export default i18n
