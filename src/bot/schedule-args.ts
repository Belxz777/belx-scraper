
export interface ScheduleArgs {
  group: string | null;
  dateArg: string;
  image?: boolean;
}

const IMAGE_TOKENS = new Set([
  "image",
  "img",
  "photo",
  "pic",
  "фото",
  "картинка",
  "изображение",
]);

export function normalizeGroup(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function isGroupName(value: string): boolean {
  return /^[A-ZА-ЯЁ]{1,3}-\d{2}-\d+(?:-\d+)?$/i.test(
    value.trim(),
  );
}

export function isDateArg(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return (
    ["today", "tomorrow", "yesterday"].includes(normalized) ||
    /^\d{1,2}\.\d{1,2}$/.test(normalized) ||
    /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(normalized)
  );
}

export function extractScheduleUrl(raw: string): string | null {
  const match = raw.match(
    /(?:https?:\/\/)?(?:www\.)?pilot-ipek\.ru\/raspo\/[^\n]+/i,
  );

  return match ? match[0].trim() : null;
}
/**
 * Разбирает:
 *
 * /schedule
 * /schedule tomorrow
 * /schedule 23.09
 * /schedule И-26-1
 * /schedule И-26-1 tomorrow
 * /schedule tomorrow И-26-1
 */
export function parseScheduleArgs(
  raw: string,
  savedGroup: string | null,
): ScheduleArgs {
  const url = extractScheduleUrl(raw.trim());

  if (url) {
    return {
      group: savedGroup ? normalizeGroup(savedGroup) : null,
      dateArg: url,
      image: false,
    };
  }

  const tokens = raw.trim().split(/\s+/).filter(Boolean);

  let group = savedGroup ? normalizeGroup(savedGroup) : null;
  let dateArg = "today";
  let image = false;

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (isGroupName(token)) {
      group = normalizeGroup(token);
      continue;
    }

    if (IMAGE_TOKENS.has(lower)) {
      image = true;
      continue;
    }

    if (isDateArg(token)) {
      dateArg = token;
    }
  }

  return { group, dateArg, image };
}