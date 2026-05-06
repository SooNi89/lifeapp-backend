/** Nullable string — OpenAI strict structured outputs use explicit unions. */
function nullableString() {
  return { anyOf: [{ type: "string" }, { type: "null" }] };
}

/** Nullable number */
function nullableNumber() {
  return { anyOf: [{ type: "number" }, { type: "null" }] };
}

/**
 * JSON Schema for OpenAI Responses API structured output (food + supplement labels).
 * All keys required; use null when unknown (matches normalization layer).
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
    "form",
    "servingSizeText",
    "supplementFactsText",
    "otherIngredientsText",
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
    form: nullableString(),
    servingSizeText: nullableString(),
    supplementFactsText: nullableString(),
    otherIngredientsText: nullableString(),
  },
};

export const THERAPY_CHAT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assistantMessage", "memorySuggestion"],
  properties: {
    assistantMessage: { type: "string" },
    memorySuggestion: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["title", "text", "tags", "importance", "reason"],
          properties: {
            title: { type: "string" },
            text: { type: "string" },
            tags: {
              type: "array",
              items: { type: "string" },
            },
            importance: nullableNumber(),
            reason: nullableString(),
          },
        },
        { type: "null" },
      ],
    },
  },
};
