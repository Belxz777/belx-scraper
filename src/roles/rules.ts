/* Миддлевейр для онли админа*/
const ADMIN_IDS = new Set(
  (process.env.ADMIN_TG_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
/* Проверка на админа */
export function isAdmin(ctx: any): boolean {

  return ADMIN_IDS.has(String(ctx.from?.id));

}
/* Миддлевейр для онли админа*/
export const adminOnly = async (ctx: any, next: () => Promise<void>) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    return;
  }

  await next();
};