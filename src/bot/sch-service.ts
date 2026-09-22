import {
  fetchPage,
  sleep,
} from "../fetcher";

import {
  parseSchedulePage,
} from "../parser";

import {
  saveRawPage,
  saveParsedPage,
  getRawPage,
} from "../db";

import {
  toIsoDate,
  toScheduleUrl,
} from "../dates";

export type FetchStoreResult =
  | "ok"
  | "notfound"
  | "error";

export interface FetchStoreDetails {
  status: FetchStoreResult;
  isoDate: string;
  error?: string;
}

/**
 * Скачать расписание конкретного дня,
 * распарсить и сохранить в SQLite.
 */
export async function fetchAndStore(
  date: Date,
): Promise<FetchStoreDetails> {
  const isoDate = toIsoDate(date);
  const url = toScheduleUrl(date);

  const result = await fetchPage(url);

  if (!result.ok) {
    saveRawPage({
      isoDate,
      url,
      status: "error",
      httpStatus: result.status,
    });

    return {
      status:
        result.status === 404
          ? "notfound"
          : "error",

      isoDate,

      error: result.error,
    };
  }

  saveRawPage({
    isoDate,
    url,
    status: "ok",
    httpStatus: result.status,
    html: result.html,
  });

  const parsed = parseSchedulePage(
    result.html!,
    isoDate,
  );

  saveParsedPage(parsed);

  return {
    status: "ok",
    isoDate,
  };
}

/**
 * Если даты нет в БД — скачивает её.
 *
 * Если она уже есть — ничего не делает.
 */
export async function ensureSchedule(
  date: Date,
): Promise<FetchStoreDetails> {
  const isoDate = toIsoDate(date);

  const existing = getRawPage(isoDate);

  if (
    existing &&
    existing.status === "ok"
  ) {
    return {
      status: "ok",
      isoDate,
    };
  }

  return fetchAndStore(date);
}

/**
 * Можно использовать при массовой загрузке дней.
 */
export async function fetchAndStoreRange(
  start: Date,
  end: Date,
) {
  const current = new Date(start);

  while (current <= end) {
    await fetchAndStore(current);

    current.setDate(
      current.getDate() + 1,
    );

    await sleep(400);
  }
}