import i18n from './i18n'

/** BCP-47 tag for dates/numbers shown in the UI: follows the UI language, English (US) by default. */
export function uiLocaleTag(): string {
	return (i18n.language ?? 'en').startsWith('it') ? 'it-IT' : 'en-US'
}
