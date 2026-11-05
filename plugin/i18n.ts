import en from '../locales/en.json';
import fr from '../locales/fr.json';
import type { DraftLanguage } from './substack';

const messages = { en, fr };
export type Locale = keyof typeof messages;
export type MessageKey = keyof typeof en;
let locale: Locale = 'en';

export function resolveLocale(language: string): Locale {
	const requested = language.toLowerCase().replace(/_/g, '-');
	const candidate = Object.prototype.hasOwnProperty.call(messages, requested) ? requested : requested.split('-')[0];
	return Object.prototype.hasOwnProperty.call(messages, candidate) ? candidate as Locale : 'en';
}

export function setLocale(language: string): void { locale = resolveLocale(language); }
export function getLocale(): Locale { return locale; }

export function draftLanguageName(language: DraftLanguage): string {
	const keys: Record<DraftLanguage, MessageKey> = { en: 'languageEnglish', es: 'languageSpanish', de: 'languageGerman', it: 'languageItalian', pt: 'languagePortuguese', fr: 'languageFrench' };
	return t(keys[language]);
}

export function t(key: MessageKey, parameters: Record<string, string> = {}, language: Locale = locale): string {
	const message = messages[language][key] ?? en[key];
	return message.replace(/\{(\w+)\}/g, (_match, name: string) => {
		if (!Object.prototype.hasOwnProperty.call(parameters, name)) throw new Error(t('translationParameterMissing', { name }, language));
		return parameters[name];
	});
}
