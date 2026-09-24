import { logger } from "../logs/logger";

/* Миддлевейр для онли админа*/
const log = logger.child({ module: "rules.ts" });
const ADMIN_IDS = new Set(
  (process.env.ADMIN_TG_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
/* Проверка на админа */
export function isAdmin(ctx: any): boolean {
  log.debug(`isAdmin check from id=${ctx.from?.id}`);
  return ADMIN_IDS.has(String(ctx.from?.id));
}

