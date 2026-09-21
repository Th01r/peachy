import { Hono } from "hono";
import type { Env } from "../index";
import { bookedJobCount } from "../lib/capacity";

export const capacity = new Hono<{ Bindings: Env }>();

capacity.get("/", async (c) => {
  const booked = await bookedJobCount(c.env);
  const max = Number(c.env.MAX_ACTIVE_JOBS);
  return c.json({ full: booked >= max, booked, max });
});
