import { parseScheduleSlug } from "../dates";
import { logger } from "../logs/logger";
import { MONTHS_GENITIVE, MONTHS_INDEX } from "../types/constant";
import {
	addDays,
	getStudyWeekPair,
	pad2,
	startOfDay,
	toPairedSlug,
} from "../utils";

const log = logger.child({ module: "url.ts", name: "url_formation" });
/**
 * ф-ция приводит число к двухзначному формату
 *  пример: 1 -> 01, 10 -> 10 и т.д.
 * нужно потому что ипэк принимает первые 10 дней в формате /raspo/01 сентября
 *  */

/**
 * Разбор пользовательского ввода, который может быть URL сайта.
 * Возвращает массив дат или null, если это не URL.
 */
export function parseScheduleUrl(
	input: string,
	now: Date = new Date(),
): Date[] | null {
	const trimmed = input.trim();

	const match = trimmed.match(
		/^(?:https?:\/\/)?(?:www\.)?pilot-ipek\.ru\/raspo\/(.+)$/i,
	);
	if (!match) return null;

	const captured = match[1];
	if (captured === undefined) return null; // или throw

	const slug = decodeURIComponent(captured).trim();
	const year = now.getFullYear();

	const dates = parseScheduleSlug(slug, year);
	if (dates.length === 0) return null;

	// Та же корректировка года, что и в parseUserDate.
	const halfYearAgo = new Date(now);
	halfYearAgo.setDate(now.getDate() - 183);

	return dates.map((d) =>
		d.getTime() < halfYearAgo.getTime()
			? new Date(d.getFullYear() + 1, d.getMonth(), d.getDate())
			: d,
	);
}
/** JS Date -> "23 сентября" (без года, как в URL сайта) */
export function toUrlDatePart(date: Date): string {
	const day = pad2(date.getDate());
	const month = MONTHS_GENITIVE[date.getMonth()] ?? MONTHS_GENITIVE[0];
	return `${day} ${month}`;
}

/** Единый URL расписания для любой даты — всегда парный (пятница+суббота) */
/** Единый URL расписания.
 *
 * Правила сайта:
 *   пт  -> парный "25, 26 сентября"
 *   сб  -> парный "25, 26 сентября" (та же страница, что и пятница)
 *   пн..чт, вс -> одиночный "28 сентября"
 */
export function toScheduleUrl(date: Date): string {
	const d = startOfDay(date); //
	const day = d.getDay(); // 0=вс, 1=пн, ..., 5=пт, 6=сб

	// Суббота — часть пары пт+сб
	if (day === 6) {
		const [fri] = getStudyWeekPair(d);
		const sat = addDays(fri, 1);
		const slug = toPairedSlug(fri, sat);
		log.debug(`toScheduleUrl slug=${slug} (sat -> fri+sat)`);
		return `https://www.pilot-ipek.ru/raspo/${encodeURI(slug)}`;
	}

	// Пятница — пара с субботой
	if (day === 5) {
		const sat = addDays(d, 1);
		const slug = toPairedSlug(d, sat);
		log.debug(`toScheduleUrl slug=${slug} (fri+sat)`);
		return `https://www.pilot-ipek.ru/raspo/${encodeURI(slug)}`;
	}

	// Пн..чт (и вс на всякий случай) — одиночный день
	const slug = toUrlDatePart(d);
	log.debug(`toScheduleUrl slug=${slug} (single)`);
	return `https://www.pilot-ipek.ru/raspo/${encodeURI(slug)}`;
}
/** "23 сентября" (строка из URL/страницы) -> JS Date. Год не известен из строки — передаём отдельно. */
export function fromUrlDatePart(part: string, year: number): Date | null {
	const m = part.trim().match(/^(\d{1,2})\s+([а-яё]+)$/i);
	if (!m) return null;
	const day = Number(m[1]);
	const monthName = m[2];
	if (!monthName) return null;
	const monthIdx = MONTHS_INDEX.get(monthName.toLowerCase());
	if (monthIdx === undefined) return null;
	return new Date(year, monthIdx, day);
}
