# LifeApp backend API

Small Node.js service for the LifeApp iOS client. It keeps OpenAI keys server-side and exposes:

- **`POST /parse-food-label`** for packaged food/supplement label parsing.
- **`POST /therapy/chat`** for the Therapy Chat MVP.

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

## POST /therapy/chat

Accepts JSON from the iOS therapy module:

```json
{
  "userMessage": "Мне сложно понять, почему я так резко реагирую.",
  "recentMessages": [
    {
      "role": "user",
      "text": "Вчера опять поссорилась.",
      "createdAt": "2026-05-06T10:00:00Z",
      "linkedDay": "2026-05-06T00:00:00Z"
    }
  ],
  "selectedDay": "2026-05-06T00:00:00Z",
  "memoryNotes": [
    {
      "title": "Повторяющийся страх отвержения",
      "text": "В близких отношениях часто появляется резкая тревога, если ответ задерживается.",
      "tags": ["отношения", "тревога"],
      "importance": 0.82
    }
  ],
  "therapyProfile": {
    "systemPrompt": "...",
    "communicationStyle": "...",
    "memoryRules": "...",
    "forbiddenBehaviors": ["морализаторство", "общие self-help клише"]
  },
  "dayContext": {
    "sleepSummary": "Сон: 23:40–07:15",
    "workoutsSummary": "Тренировка: 3 из 5 упражнений",
    "steps": 8200,
    "moodStateNotes": ["Спокойно: усталость"],
    "cycleInfo": null,
    "importantEntries": []
  }
}
```

Validation and limits:

- `userMessage` is required.
- `recentMessages` is optional and limited to the last 30.
- `memoryNotes` is optional and limited to 20.
- Long text fields and nested day context are truncated before calling OpenAI.
- Production logs should contain request id, status, and timing only, not full therapy text.

Response:

```json
{
  "assistantMessage": "Похоже, здесь важна не только сама ситуация, а скорость, с которой она становится доказательством чего-то про вас или отношения.",
  "memorySuggestion": {
    "title": "Быстрая тревога при задержке ответа",
    "text": "В близких отношениях задержка ответа может быстро переживаться как признак отвержения или потери контакта.",
    "tags": ["отношения", "тревога"],
    "importance": 0.82,
    "reason": "Это похоже на устойчивый повторяющийся паттерн, а не на разовую бытовую ситуацию."
  }
}
```

`memorySuggestion` may be `null`. The backend only suggests memory candidates; the app decides whether to save them.

## POST /parse-food-label

### Example success response

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
| 400 | Missing/invalid `image` field, bad upload, invalid JSON, missing `userMessage`, or request body too large |
| 422 | Model refusal, or JSON/schema could not be validated after the call |
| 500 | Missing `OPENAI_API_KEY`, OpenAI/network failure, or unexpected server error |

Error bodies are JSON: `{ "error": "code", "message": "..." }`. Raw model text is not returned on parse failures.
