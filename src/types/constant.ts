export const MONTHS_GENITIVE = [
	"января",
	"февраля",
	"марта",
	"апреля",
	"мая",
	"июня",
	"июля",
	"августа",
	"сентября",
	"октября",
	"ноября",
	"декабря",
] as const;

export const MONTHS_INDEX = new Map<string, number>(
	MONTHS_GENITIVE.map((m, i) => [m, i]),
);
export const UA =
	"Mozilla/5.0 (compatible; pilot-ipek-schedule-bot/1.0; +for personal use)";
