// ---------------------------------------------------------------------------
// Уровни
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

// ---------------------------------------------------------------------------
// Настройки из окружения
// ---------------------------------------------------------------------------

const ENV_LEVEL = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
const MIN_LEVEL = LEVELS[ENV_LEVEL] ?? LEVELS.info;

// "pretty" для dev, "json" для прод-логов
const FORMAT = (process.env.LOG_FORMAT ?? "pretty").toLowerCase();

const USE_COLOR = FORMAT === "pretty" && process.stdout.isTTY === true;

// ---------------------------------------------------------------------------
// Цвета (ANSI)
// ---------------------------------------------------------------------------

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

const LEVEL_COLOR: Record<Exclude<LogLevel, "silent">, string> = {
  debug: C.gray,
  info: C.cyan,
  warn: C.yellow,
  error: C.red,
};

const LEVEL_LABEL: Record<Exclude<LogLevel, "silent">, string> = {
  debug: "DBG",
  info: "INF",
  warn: "WRN",
  error: "ERR",
};

function color(code: string, value: string): string {
  if (!USE_COLOR) return value;
  return `${code}${value}${C.reset}`;
}

// ---------------------------------------------------------------------------
// Форматирование
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function nowShort(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}`
  );
}

function fmtValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Error) return v.stack ?? v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ---------------------------------------------------------------------------
// Тип контекста
// ---------------------------------------------------------------------------

export interface LogContext {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Ядро логгера
// ---------------------------------------------------------------------------

export class Logger {
  private base: LogContext;

  constructor(base: LogContext = {}) {
    this.base = base;
  }

  /**
   * Создать дочерний логгер с дополнительным контекстом.
   *
   * const log = logger.child({ module: "sch-service" });
   */
  child(extra: LogContext): Logger {
    return new Logger({ ...this.base, ...extra });
  }

  private shouldLog(level: Exclude<LogLevel, "silent">): boolean {
    return LEVELS[level] >= MIN_LEVEL;
  }

  private emit(
    level: Exclude<LogLevel, "silent">,
    msg: string,
    ctx?: LogContext,
  ): void {
    if (!this.shouldLog(level)) return;

    const merged = { ...this.base, ...(ctx ?? {}) };

    // -----------------------------------------------------------------------
    // JSON-режим (прод)
    // -----------------------------------------------------------------------
    if (FORMAT === "json") {
      const record: Record<string, unknown> = {
        ts: nowIso(),
        level,
        msg,
      };

      // Error — разворачиваем в удобную форму
      for (const [k, v] of Object.entries(merged)) {
        if (v instanceof Error) {
          record[k] = {
            name: v.name,
            message: v.message,
            stack: v.stack,
          };
        } else {
          record[k] = v;
        }
      }

      const stream = level === "error" || level === "warn"
        ? process.stderr
        : process.stdout;

      stream.write(JSON.stringify(record) + "\n");
      return;
    }

    // -----------------------------------------------------------------------
    // Pretty-режим (dev)
    // -----------------------------------------------------------------------
    const time = color(C.gray, nowShort());
    const lvl = color(
      LEVEL_COLOR[level],
      LEVEL_LABEL[level],
    );

    const baseCtx: string[] = [];
    for (const [k, v] of Object.entries(this.base)) {
      baseCtx.push(`${color(C.magenta, k)}=${color(C.dim, fmtValue(v))}`);
    }

    const extraCtx: string[] = [];
    for (const [k, v] of Object.entries(ctx ?? {})) {
      if (v === undefined) continue;

      // Error рисуем отдельной строкой ниже
      if (v instanceof Error) continue;

      extraCtx.push(`${color(C.magenta, k)}=${color(C.dim, fmtValue(v))}`);
    }

    let line = `${time} ${lvl}`;
    if (baseCtx.length) line += ` ${baseCtx.join(" ")}`;
    line += ` ${msg}`;
    if (extraCtx.length) line += ` ${extraCtx.join(" ")}`;

    const stream = level === "error" || level === "warn"
      ? process.stderr
      : process.stdout;

    stream.write(line + "\n");

    // Стек ошибки — отдельными строками
    for (const v of Object.values(ctx ?? {})) {
      if (v instanceof Error && v.stack) {
        for (const l of v.stack.split("\n")) {
          stream.write(`    ${color(C.gray, l)}\n`);
        }
      }
    }
  }

  debug(msg: string, ctx?: LogContext): void {
    this.emit("debug", msg, ctx);
  }

  info(msg: string, ctx?: LogContext): void {
    this.emit("info", msg, ctx);
  }

  warn(msg: string, ctx?: LogContext): void {
    this.emit("warn", msg, ctx);
  }

  error(msg: string, ctx?: LogContext): void {
    this.emit("error", msg, ctx);
  }

  /** Явная проверка — чтобы не собирать тяжёлый контекст зря */
  isLevelEnabled(level: LogLevel): boolean {
    return LEVELS[level] >= MIN_LEVEL;
  }
}

// ---------------------------------------------------------------------------
// Корневой логгер
// ---------------------------------------------------------------------------

export const logger = new Logger({ app: "ipek-bot" });

// ---------------------------------------------------------------------------
// Хелпер: печатать ошибку + опциональный контекст
// ---------------------------------------------------------------------------

export function logError(
  log: Logger,
  msg: string,
  error: unknown,
  ctx?: LogContext,
): void {
  const err = error instanceof Error
    ? error
    : new Error(String(error));

  log.error(msg, { ...(ctx ?? {}), err });
}