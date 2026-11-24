declare const brand: unique symbol;

type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type Bdt = Brand<number, "Bdt">;
export type ImageKey = Brand<string, "ImageKey">;
export type ImageUrl = Brand<string, "ImageUrl">;
export type IsoUtcTimestamp = Brand<string, "IsoUtcTimestamp">;
export type DhakaDate = Brand<string, "DhakaDate">;

export function toBdt(value: number): Bdt {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`BDT amount must be a non-negative integer, got ${value}`);
  }
  return value as Bdt;
}

export function asImageKey(value: string): ImageKey {
  if (/^https?:\/\//i.test(value) || value.startsWith("/") || value.includes("..")) {
    throw new Error(`Expected relative R2 image key, not URL or path traversal: ${value}`);
  }
  return value as ImageKey;
}

export function asImageUrl(value: string): ImageUrl {
  return value as ImageUrl;
}

export function asIsoUtc(value: string): IsoUtcTimestamp {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error(`Expected canonical UTC ISO-8601 timestamp, got ${value}`);
  }
  return value as IsoUtcTimestamp;
}

export function asDhakaDate(value: string): DhakaDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Expected YYYY-MM-DD Asia/Dhaka date, got ${value}`);
  }
  return value as DhakaDate;
}
