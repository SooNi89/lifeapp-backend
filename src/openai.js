import { FOOD_LABEL_JSON_SCHEMA } from "./schema.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const LABEL_PROMPT = `You are reading a packaged product label photo. It may be FOOD or a DIETARY SUPPLEMENT (vitamins, minerals, herbal blends, etc.).

Classify the label and fill ONLY the fields that apply. Use null for anything not shown or not applicable.

=== FOOD (nutrition facts, ingredients list for a food product) ===
- name: product name (not slogans)
- brand: manufacturer
- ingredientsText: full ingredients list as one string
- caloriesPer100g, proteinsPer100g, fatsPer100g, carbsPer100g: per 100 g if printed
- standardPortionGrams, portionName: only if an explicit standard portion is printed
- form, servingSizeText, supplementFactsText, otherIngredientsText: null

=== DIETARY SUPPLEMENT (Supplement Facts panel, "Serving Size", active ingredients) ===
- name, brand: as printed on the label
- servingSizeText: copy the exact printed "Serving Size" line (e.g. "1 Veg Capsule", "2 Softgels"). This is the single serving the user takes. Do NOT use one vitamin's amount (e.g. "Thiamine 50 mg") as serving size — that belongs in supplement facts only.
- supplementFactsText: readable list of ACTIVE ingredients and amounts per serving only (line-separated or comma-separated). Keep units (mg, mcg, IU, g, etc). NEVER include % Daily Value, "%", or DV columns. Do NOT put the "Other ingredients" section here.
- otherIngredientsText: only the "Other ingredients" / inactive excipients list if present; otherwise null
- form: dosage form if clear in English snake_key style or plain words: capsule, tablet, softgel, powder, liquid, drops, gummy, scoop — else null
- ingredientsText: null for supplements (do not duplicate supplement facts or other ingredients here)
- caloriesPer100g, proteinsPer100g, fatsPer100g, carbsPer100g, standardPortionGrams, portionName: null unless a food-style nutrition table is clearly present

General rules:
- Prefer accuracy over guessing.
- Numeric fields: plain JSON numbers only, no units in number fields.
- Output must match the JSON schema exactly (all keys present, null when unknown).`;

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {Buffer} opts.imageBuffer
 * @param {string} opts.mimeType
 * @returns {Promise<string>} Raw JSON text from model (single object).
 */
export async function extractFoodLabelWithOpenAI({
  apiKey,
  model,
  imageBuffer,
  mimeType,
}) {
  const base64 = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const body = {
    model,
    input: [
      {
        role: "developer",
        content: [{ type: "input_text", text: LABEL_PROMPT }],
      },
      {
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: dataUrl,
            detail: "high",
          },
          {
            type: "input_text",
            text: "Return the structured fields for this label.",
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "parsed_food_label",
        strict: true,
        schema: FOOD_LABEL_JSON_SCHEMA,
      },
    },
  };

  const res = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error("OpenAI response was not valid JSON");
    err.code = "OPENAI_BAD_JSON";
    err.status = 500;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(json?.error?.message || `OpenAI HTTP ${res.status}`);
    err.code = "OPENAI_HTTP_ERROR";
    err.status = 500;
    err.openaiStatus = res.status;
    throw err;
  }

  if (json.status && json.status !== "completed") {
    const err = new Error(`OpenAI response incomplete: ${json.status}`);
    err.code = "OPENAI_INCOMPLETE";
    err.status = 500;
    throw err;
  }

  const refusal = findRefusal(json);
  if (refusal) {
    const err = new Error("Model refused to analyze this image");
    err.code = "OPENAI_REFUSAL";
    err.status = 422;
    throw err;
  }

  const outputText = extractOutputText(json);
  if (!outputText) {
    const err = new Error("No text output from OpenAI");
    err.code = "OPENAI_NO_OUTPUT";
    err.status = 500;
    throw err;
  }

  return outputText;
}

function findRefusal(responseJson) {
  const output = responseJson?.output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (item?.refusal) return item.refusal;
    const content = item?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.refusal) return part.refusal;
    }
  }
  return null;
}

/**
 * Walk Responses API `output` array for the first output_text content.
 */
function extractOutputText(responseJson) {
  const output = responseJson?.output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    const content = item?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        return part.text;
      }
    }
  }
  return null;
}
