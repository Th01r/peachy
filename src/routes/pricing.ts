import { Hono } from "hono";
import type { Env } from "../index";
import { getPricing } from "../lib/pricing";

export const pricing = new Hono<{ Bindings: Env }>();

// Comparison figures, sourced (see README §16 for citations) - not pulled from
// a live API, these are stable enough not to need per-request fetching.
const COMPARISONS = [
  { label: "A single freelance thumbnail redesign", low: 18, high: 25, unit: "per video" },
  { label: "One hour of a freelance video editor's time", low: 25, high: 40, unit: "per hour" },
  { label: "YouTube's own recommended minimum ad spend to boost one video", low: 100, high: 100, unit: "per video" },
];

pricing.get("/", (c) => {
  const info = getPricing(c.env);
  return c.json({ ...info, comparisons: COMPARISONS });
});
