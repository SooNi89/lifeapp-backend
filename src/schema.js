/** Nullable string — OpenAI strict structured outputs use explicit unions. */
function nullableString() {
  return { anyOf: [{ type: "string" }, { type: "null" }] };
}

/** Nullable number */
function nullableNumber() {
  return { anyOf: [{ type: "number" }, { type: "null" }] };
}

/**
 * JSON Schema for OpenAI Responses API structured output (food label extraction).
 * All keys are required; use null when a value is unknown (matches normalization layer).
 */
export const FOOD_LABEL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "brand",
    "ingredientsText",
    "caloriesPer100g",
    "proteinsPer100g",
    "fatsPer100g",
    "carbsPer100g",
    "standardPortionGrams",
    "portionName",
  ],
  properties: {
    name: nullableString(),
    brand: nullableString(),
    ingredientsText: nullableString(),
    caloriesPer100g: nullableNumber(),
    proteinsPer100g: nullableNumber(),
    fatsPer100g: nullableNumber(),
    carbsPer100g: nullableNumber(),
    standardPortionGrams: nullableNumber(),
    portionName: nullableString(),
  },
};
