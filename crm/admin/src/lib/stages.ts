import type { Stage } from "../types";

export const STAGE_META: { key: Stage; label: string; hint: string }[] = [
  { key: "new", label: "New", hint: "Just arrived" },
  { key: "contacted", label: "Contacted", hint: "Reached out" },
  { key: "quoted", label: "Quoted", hint: "Price sent" },
  { key: "scheduled", label: "Scheduled", hint: "On the calendar" },
  { key: "customer", label: "Customer", hint: "Job done" },
  { key: "lost", label: "Lost", hint: "No deal" },
];
