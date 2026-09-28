import i18n, { type InitOptions } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import translationEN from "../assets/locales/en/translations.json";
import translationES from "../assets/locales/es/translations.json";
import translationIT from "../assets/locales/it/translations.json";
import { isProduction } from "./utils";

export const defaultNS = "translations";
export const resources = {
	en: { translations: translationEN },
	es: { translations: translationES },
	it: { translations: translationIT },
	"it-IT": { translations: translationIT },
} as const;

const i18nOptions: InitOptions = {
	defaultNS,
	ns: [defaultNS],
	resources,
	debug: !isProduction,
	fallbackLng: "en",
	// Only en/it ship real translations (es has a single placeholder key) — never let the detector
	// or a stale localStorage value select anything else. Regional tags (it-IT, en-GB) map to the base.
	supportedLngs: ["en", "it"],
	nonExplicitSupportedLngs: true,
	// No hard-coded `lng`: let LanguageDetector decide (stored preference → browser language),
	// falling back to English. Forcing 'it' here made the app Italian for everyone — including
	// English visitors who reached /signup or /login from the English landing. The landing pages
	// also set the language from their URL locale (/ = en, /it = it), so arriving from the
	// English site keeps signup/login in English.
	lng: typeof localStorage !== 'undefined' ? (localStorage.getItem('i18nextLng') ?? undefined) : undefined,
	interpolation: {
		escapeValue: false, // not needed for react as it escapes by default
	},
};

void i18n
	.use(initReactI18next)
	.use(LanguageDetector)
	.init(i18nOptions);

export default i18n;
