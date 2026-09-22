export interface FetchResult {
  ok: boolean;
  status: number;
  html?: string;
  error?: string;
}

const UA =
  "Mozilla/5.0 (compatible; pilot-ipek-schedule-bot/1.0; +for personal use)";

/** Скачивает страницу с несколькими попытками и вежливым таймаутом. */
export async function fetchPage(
  url: string,
  opts: { retries?: number; timeoutMs?: number } = {}
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
