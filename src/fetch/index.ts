import { getRawPage, saveParsedPage, saveRawPage, touchRawPage } from "../db";
import { parseSchedulePage } from "../parser";
import type { FetchResult } from "../types";
import { UA } from "../types/constant";
import { toScheduleUrl } from "../url";
import { toIsoDate } from "../utils";

export type FetchStoreResult = "ok" | "notfound" | "error";

export interface FetchStoreDetails {
	status: FetchStoreResult;
	isoDate: string;
	error?: string;
}
const REFRESH_INTERVAL_MS =
	(Number(process.env.REFRESH_TIMEOUT_SEC) || 600) * 1000;

function isFresh(fetchedAt: string, now: number = Date.now()): boolean {
	const t = Date.parse(fetchedAt);
	if (Number.isNaN(t)) return false;
	return now - t < REFRESH_INTERVAL_MS;
}
export interface FetchOptions {
	/**
	 * Принудительно сходить в сеть, игнорируя TTL кэша.
	 * Может пригодиться для /refresh или админ-команд.
	 */
	force?: boolean;
}

/** Скачивает страницу с несколькими попытками и вежливым таймаутом. */
export async function fetchPage(
	url: string,
	opts: { retries?: number; timeoutMs?: number } = {},
): Promise<FetchResult> {
	const retries = opts.retries ?? 2;
	const timeoutMs = opts.timeoutMs ?? 15_000;

	let lastError = "";
	for (let attempt = 0; attempt <= retries; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetch(url, {
				headers: { "User-Agent": UA, "Accept-Language": "ru,en;q=0.8" },
				signal: controller.signal,
			});
			clearTimeout(timer);

			if (!res.ok) {
				lastError = `HTTP ${res.status}`;
				if (res.status === 404) {
					return { ok: false, status: res.status, error: lastError };
				}
			} else {
				const html = await res.text();
				return { ok: true, status: res.status, html };
			}
		} catch (err) {
			clearTimeout(timer);
			lastError = err instanceof Error ? err.message : String(err);
		}

		if (attempt < retries) await sleep(500 * (attempt + 1));
	}

	return { ok: false, status: 0, error: lastError };
}

export function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Скачать расписание конкретного дня,
 * распарсить и сохранить в SQLite.
 */
export async function fetchAndStore(
	date: Date,
	opts: FetchOptions = {},
): Promise<FetchStoreDetails> {
	const isoDate = toIsoDate(date);
	const existing = getRawPage(isoDate);
	if (
		!opts.force &&
		existing &&
		existing.status === "ok" &&
		isFresh(existing.fetched_at)
	) {
		return { status: "ok", isoDate };
	}
	const url = toScheduleUrl(date);
	const result = await fetchPage(url);

	if (!result.ok) {
		const status: FetchStoreResult =
			result.status === 404 ? "notfound" : "error";

		if (existing && existing.status === "ok" && existing.html) {
			return {
				status,
				isoDate,
				error: result.error,
			};
		}

		// Рабочего кэша нет — фиксируем неудачу, чтобы не долбить сервер
		// на каждый запрос.
		saveRawPage({
			isoDate,
			url,
			status: "error",
			httpStatus: result.status,
		});

		return {
			status,
			isoDate,
			error: result.error,
		};
	}

	const newHtml = result.html ?? "";
	if (existing && existing.status === "ok" && existing.html === newHtml) {
		touchRawPage(isoDate);
		return { status: "ok", isoDate };
	}
	saveRawPage({
		isoDate,
		url,
		status: "ok",
		httpStatus: result.status,
		html: newHtml,
	});

	const parsed = parseSchedulePage(newHtml, isoDate);
	saveParsedPage(parsed);

	return { status: "ok", isoDate };
}

/**
 * Если даты нет в БД — скачивает её. через fetchAndStore()
 *
 * Если она уже есть — ничего не делает. getRawPage() вернёт её.
 */
export async function ensureSchedule(date: Date): Promise<FetchStoreDetails> {
	return fetchAndStore(date);
}

/**
 * Можно использовать при массовой загрузке дней.
 */
export async function fetchAndStoreRange(start: Date, end: Date) {
	const current = new Date(start);

	while (current <= end) {
		await fetchAndStore(current);

		current.setDate(current.getDate() + 1);

		await sleep(400);
	}
}
