import { ensureSchedule } from "../bot/sch-service";


const t0 = Date.now();
console.log("before ensureSchedule");

try {
  const res = await ensureSchedule(new Date());
  console.log("done:", res, "in", Date.now() - t0, "ms");
} catch (e) {
  console.error("threw:", e);
}