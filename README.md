# Food label parsing API

Small Node.js service for the LifeApp iOS client: **`POST /parse-food-label`** accepts a multipart image, calls the OpenAI **Responses** API with vision + structured JSON, then returns normalized JSON (no API keys to the app).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | **Yes** | Server-side secret; never ship to iOS. |
| `PORT` | No | Listen port (default **`8787`**, matches app dev default). |
| `OPENAI_MODEL` | No | Model id (default **`gpt-4o`**). Use a snapshot that supports Responses + structured outputs (e.g. `gpt-4o-2024-08-06`). |

Example:

```bash
export OPENAI_API_KEY="sk-..."
export PORT=8787
export OPENAI_MODEL="gpt-4o"
npm start
```

## Run locally

```bash
cd backend
npm install
npm start
```

Health check: `GET /health`

## Example success response

```json
{
  "name": "Greek yogurt 2%",
  "brand": "Example Dairy",
  "ingredientsText": "Pasteurized milk, cream, live cultures.",
  "caloriesPer100g": 97,
  "proteinsPer100g": 9.2,
  "fatsPer100g": 5,
  "carbsPer100g": 3.6,
  "standardPortionGrams": 150,
  "portionName": "1 container",
  "form": null,
  "servingSizeText": null,
  "supplementFactsText": null,
  "otherIngredientsText": null
}
```

For **dietary supplement** labels, `ingredientsText` is usually `null` while `servingSizeText` (Serving Size line), `supplementFactsText` (active ingredients per serving), and `otherIngredientsText` are filled. Food products use `ingredientsText` and nutrition fields; supplement-specific strings are `null`.

All keys are always present; values may be `null` when not clearly visible on the label.

## HTTP errors

| Status | Meaning |
|--------|---------|
| 400 | Missing/invalid `image` field or bad upload |
| 422 | Model refusal, or JSON/schema could not be validated after the call |
| 500 | Missing `OPENAI_API_KEY`, OpenAI/network failure, or unexpected server error |

Error bodies are JSON: `{ "error": "code", "message": "..." }`. Raw model text is not returned on parse failures.
