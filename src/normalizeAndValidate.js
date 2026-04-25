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
  "form",
  "servingSizeText",
  "supplementFactsText",
  "otherIngredientsText",
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

function normalizeSupplementFactsText(value) {
  const base = coerceNullableString(value);
  if (!base) return null;

  // Unify delimiters and remove obvious Daily Value headers.
  const chunks = base
    .replace(/\r/g, "\n")
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((line) => !/daily\s*value|%dv|%\s*dv/i.test(line));

  const cleaned = chunks
    .map((line) =>
      line
        // Remove trailing percentage blocks: "4167%", "75 %", "% Daily Value"
        .replace(/\b\d+(?:[.,]\d+)?\s*%(\s*(daily\s*value|dv))?\b/gi, "")
        .replace(/%\s*(daily\s*value|dv)?/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim()
    )
    .filter(Boolean)
    .flatMap(splitIngredientLine);

  return cleaned.length ? cleaned.join("\n") : null;
}

function splitIngredientLine(line) {
  const out = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);

    if (ch === "," && depth === 0) {
      const rest = line.slice(i + 1).trimStart();
      // Split only when comma is likely between ingredient records.
      if (/^[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9(]/.test(rest)) {
        if (current.trim()) out.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
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
    } else if (key === "supplementFactsText") {
      out[key] = normalizeSupplementFactsText(raw?.[key]);
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
