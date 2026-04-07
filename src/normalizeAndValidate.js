const NUMERIC_FIELDS = new Set([
  "caloriesPer100g",
  "proteinsPer100g",
  "fatsPer100g",
  "carbsPer100g",
  "standardPortionGrams",
]);

const STRING_FIELDS = new Set([
  "name",
  "brand",
  "ingredientsText",
  "portionName",
]);

const ALL_KEYS = [...NUMERIC_FIELDS, ...STRING_FIELDS];

/**
 * Parse a numeric value from model output (number or localized string).
 * Returns null if not clearly a finite non-negative number.
 */
export function coerceNullableNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed
      .replace(/\s/g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");
    const n = Number(normalized);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }
  return null;
}

function coerceNullableString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length ? t : null;
}

/**
 * Ensures the API response shape for the iOS client.
 * Trims strings, coerces obvious numerics, maps empty to null.
 */
export function normalizeParsedLabel(raw) {
  const out = {};
  for (const key of ALL_KEYS) {
    if (NUMERIC_FIELDS.has(key)) {
      out[key] = coerceNullableNumber(raw?.[key]);
    } else {
      out[key] = coerceNullableString(raw?.[key]);
    }
  }
  return out;
}

/**
 * Returns true if the object looks like a valid top-level label payload (keys only).
 */
export function hasValidLabelShape(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  for (const key of ALL_KEYS) {
    if (!(key in obj)) return false;
  }
  return true;
}
