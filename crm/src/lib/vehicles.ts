/**
 * Vehicle types the customer sees, and the price bucket each one bills as.
 *
 * The menu prices against six size classes, but "SUV" is a poor thing to say to
 * someone standing next to a Suburban. These ten types are what gets shown; the
 * bucket is what gets charged, and the wizard always displays which bucket it
 * used so a mis-mapping is visible rather than silent.
 */
export const SIZE_CLASSES = ["sedan", "suv", "truck", "van", "exotic", "other"] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];

export interface VehicleType {
  value: string;
  label: string;
  /** What this type is billed as. */
  bucket: SizeClass;
  /** Shown under the label when it differs from the plain reading of the type. */
  note?: string;
}

export const VEHICLE_TYPES: VehicleType[] = [
  { value: "sedan",      label: "Sedan",       bucket: "sedan" },
  { value: "coupe",      label: "Coupe",       bucket: "sedan",  note: "priced as sedan" },
  { value: "hatchback",  label: "Hatchback",   bucket: "sedan",  note: "priced as sedan" },
  { value: "small_suv",  label: "Small SUV",   bucket: "suv" },
  { value: "mid_suv",    label: "Mid SUV",     bucket: "suv" },
  { value: "large_suv",  label: "Large SUV",   bucket: "suv",    note: "priced as SUV" },
  { value: "pickup",     label: "Pickup Truck", bucket: "truck" },
  { value: "van",        label: "Van",         bucket: "van" },
  { value: "exotic",     label: "Exotic / Lux", bucket: "exotic" },
  { value: "oversized",  label: "Oversized",   bucket: "truck",  note: "priced as truck" },
];

const BY_VALUE = new Map(VEHICLE_TYPES.map((v) => [v.value, v]));

export function vehicleType(value: string | null | undefined): VehicleType | null {
  return value ? BY_VALUE.get(value) ?? null : null;
}

/** Price bucket for a vehicle type, falling back to the widest tier. */
export function bucketFor(value: string | null | undefined): SizeClass {
  return vehicleType(value)?.bucket ?? "other";
}

/**
 * Price of a service for a bucket. Falls back to the base price when a size has
 * no explicit entry — a missing size should never quote as free.
 */
export function priceFor(
  pricing: Record<string, number> | null | undefined,
  bucket: SizeClass,
  basePriceCents: number
): number {
  const p = pricing?.[bucket];
  return Number.isFinite(p) && (p as number) > 0 ? Math.round(p as number) : Math.max(0, Math.round(basePriceCents));
}
