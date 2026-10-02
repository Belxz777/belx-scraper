// Даты: сайт использует в URL формат "23 сентября" (число + месяц в родительном падеже),
// а для парных страниц (пт + сб) — "25, 26 сентября".
import { logger } from "./logs/logger";
import { MONTHS_INDEX } from "./types/constant";
import { parseScheduleUrl } from "./url";
import { addDays, startOfDay } from "./utils";

// Здесь всё, что нужно, чтобы конвертировать в обе стороны и принимать удобный ввод от пользователя.
const log = logger.child({ module: "dates.ts" });

/** Универсальный резолвер: URL или обычная дата -> массив Date. */
export function resolveDates(input: string, now: Date = new Date()): Date[] {
	const urlDates = parseScheduleUrl(input, now);
	if (urlDates) return urlDates;
	return [parseUserDate(input, now)];
}

/**
 * Обратный разбор слага в список дат. Год в слаге не хранится — передаём отдельно.
 *
 * Поддерживает:
 *   "25 сентября"                -> [25 сент]
 *   "25, 26 сентября"            -> [25 сент, 26 сент]
 *   "30 сентября, 1 октября"     -> [30 сент, 1 окт]
 *
 * Возвращает [] если слаг не распознан.
 */
export function parseScheduleSlug(slug: string, year: number): Date[] {
	const decoded = decodeURIComponent(slug).trim();

	//* пример: "25, 26 сентября"
	let m = decoded.match(/^(\d{1,2}),\s*(\d{1,2})\s+([а-яё]+)$/i);
	// ? исплользуем m[x]! так как есть увереность что m не undefined , потому что проверяем
	if (m) {
		const month = MONTHS_INDEX.get(m[3]!.toLowerCase());
		if (month === undefined) return [];
		return [
			new Date(year, month, Number(m[1])),
			new Date(year, month, Number(m[2])),
		];
	}

	// "30 сентября, 1 октября"
	m = decoded.match(/^(\d{1,2})\s+([а-яё]+),\s*(\d{1,2})\s+([а-яё]+)$/i);
	if (m) {
		const monthA = MONTHS_INDEX.get(m[2]!.toLowerCase());
		const monthB = MONTHS_INDEX.get(m[4]!.toLowerCase());
		if (monthA === undefined || monthB === undefined) return [];
		return [
			new Date(year, monthA, Number(m[1])),
			new Date(year, monthB, Number(m[3])),
		];
	}

	// в случае "25 сентября"
	m = decoded.match(/^(\d{1,2})\s+([а-яё]+)$/i);
	if (m) {
		const month = MONTHS_INDEX.get(m[2]!.toLowerCase());

		if (month === undefined) return [];
		return [new Date(year, month, Number(m[1]))];
	}

	return [];
}
/**
 * Разбор пользовательского ввода даты:
 *  - "today" / "сегодня"
 *  - "tomorrow" / "завтра"
 *  - "yesterday" / "вчера"
 *  - "23.09.2026"
 *  - "23.09" (год берётся текущий; если дата уже прошла больше чем на полгода — считаем, что имелся в виду следующий год)
 */
export function parseUserDate(input: string, now: Date = new Date()): Date {
	const s = input.trim().toLowerCase();
	if (s === "today" || s === "сегодня") return startOfDay(now);
	if (s === "tomorrow" || s === "завтра") return addDays(startOfDay(now), 1);
	if (s === "yesterday" || s === "вчера") return addDays(startOfDay(now), -1);

	const m = s.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
	if (!m) {
		throw new Error(
			`Не понял дату: "${input}". Ожидался формат DD.MM.YYYY, DD.MM, today/tomorrow/yesterday.`,
		);
	}
	const day = Number(m[1]);
	const month = Number(m[2]) - 1;
	let year = m[3] ? Number(m[3]) : now.getFullYear();

	if (!m[3]) {
		const guess = new Date(year, month, day);
		const diffDays = (guess.getTime() - startOfDay(now).getTime()) / 86_400_000;
		if (diffDays < -183) year += 1; // явно прошлый год не имелся в виду
	}
	return new Date(year, month, day);
}
