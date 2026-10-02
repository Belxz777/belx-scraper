export interface FetchResult {
	ok: boolean;
	status: number;
	html?: string;
	error?: string;
}

export interface LessonCell {
	group: string;
	lines: string[];
	subject: string | null;
	teacher: string | null;
	room: string | null;
	flags: string[];
	confidence: "high" | "low";
}

export interface PeriodRow {
	periodNo: number | null;
	timeRange: string | null;
	label: string;
	cells: LessonCell[];
}

export interface TableBlock {
	kind: "table";
	index: number;
	groups: string[];
	periods: PeriodRow[];
}

export interface UnstructuredBlock {
	kind: "unstructured";
	index: number;
	groups: string[];
	rawText: string;
}

export type ScheduleBlock = TableBlock | UnstructuredBlock;

// ---------------------------------------------------------------------------
// Один день расписания
// ---------------------------------------------------------------------------

export interface ParsedDay {
	/** "YYYY-MM-DD" */
	isoDate: string;

	/** "25 сентября 2026" — как в заголовке страницы */
	dateText: string | null;

	/** "пятница" / "суббота" / ... */
	weekday: string | null;

	blocks: ScheduleBlock[];
}

export interface ParsedPage {
	/** Основная дата (первая найденная или fallback). */
	isoDate: string;

	title: string | null;

	/** Дни в порядке появления на странице. */
	days: ParsedDay[];

	/**
	 * Плоский список всех блоков всех дней — для отладки и обратной
	 * совместимости. Сохранять по нему НЕЛЬЗЯ, дата неоднозначна.
	 */
	blocks: ScheduleBlock[];
}
