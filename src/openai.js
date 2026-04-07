import { FOOD_LABEL_JSON_SCHEMA } from "./schema.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const LABEL_PROMPT = `You are reading a packaged food product label photo.

Extract ONLY these fields if they are clearly visible on the label. If uncertain or not shown, use null.
- Product name (not marketing slogans)
- Brand / manufacturer name
- Full ingredients list text as printed (one string)
- Nutritional values per 100 g: calories (kcal), protein (g), fat (g), carbohydrates (g)
- Standard portion size in grams and its name (e.g. "30 g", "1 slice") only if explicitly printed

Rules:
- Prefer precision over completeness; do not guess aggressively.
- Numbers must be plain numbers in the JSON (e.g. 12.5), not strings.
- Do not include units in numeric fields.
- Do not add fields beyond the schema.
- Output must match the JSON schema only.`;

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
