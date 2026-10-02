import { MONTHS_GENITIVE } from "../types/constant";

export function pad2(n: number): string {
	return String(n).padStart(2, "0");
}
export function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
	const copy = new Date(d);
	copy.setDate(copy.getDate() + days);
	return copy;
}

/** Включительный диапазон дат от start до end */
export function dateRange(start: Date, end: Date): Date[] {
	const out: Date[] = [];
	let cur = startOfDay(start);
	const last = startOfDay(end);
	while (cur.getTime() <= last.getTime()) {
		out.push(cur);
		cur = addDays(cur, 1);
	}
	return out;
}
export function toPairedSlug(friday: Date, saturday: Date): string {
	return `${pad2(friday.getDate())}, ${pad2(saturday.getDate())} ${MONTHS_GENITIVE[friday.getMonth()]}`;
}

/** JS Date -> "YYYY-MM-DD", используется как первичный ключ в БД */
export function toIsoDate(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

export function getStudyWeekPair(date: Date): [Date, Date] {
	const d = startOfDay(date);

	// getDay(): 0=вс, 1=пн, ..., 5=пт, 6=сб
	const day = d.getDay();

	// сколько дней до ближайшей пятницы (включая сегодня, если это пт)
	let diffToFriday: number;
	if (day === 5) diffToFriday = 0;
	else if (day === 6)
		diffToFriday = -1; // суббота → пятница была вчера
	else if (day === 0)
		diffToFriday = -2; // воскресенье → пятница позавчера
	else diffToFriday = 5 - day; // пн..чт → вперёд к пятнице

	const friday = addDays(d, diffToFriday);
	const saturday = addDays(friday, 1);

	return [friday, saturday];
}
