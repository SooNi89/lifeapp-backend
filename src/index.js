import 'dotenv/config';
import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import { extractFoodLabelWithOpenAI, therapyChatWithOpenAI } from "./openai.js";
import {
  normalizeParsedLabel,
  hasValidLabelShape,
} from "./normalizeAndValidate.js";

const PORT = Number(process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

// TODO: Attach a confidence score per field or overall and surface 422 when below threshold.
// TODO: Accept barcode / EAN image crop and resolve product via open food facts or similar.
// TODO: Support plate / meal photos (different schema and prompts from packaged labels).
// TODO: Multilingual labels: detect language and normalize units (kJ vs kcal) before numbers.
// TODO: Portion heuristics: infer serving from "per package" + net weight when per-100g is shown.

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
});

const app = express();
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/therapy/chat", async (req, res) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    if (!OPENAI_API_KEY) {
      logTherapyRequest(requestId, 500, startedAt);
      return res.status(500).json({
        error: "server_misconfiguration",
        message: "OPENAI_API_KEY is not set",
      });
    }

    const validation = validateAndSanitizeTherapyRequest(req.body);
    if (!validation.ok) {
      logTherapyRequest(requestId, 400, startedAt);
      return res.status(400).json({
        error: validation.error,
        message: validation.message,
      });
    }

    let modelJsonText;
    try {
      modelJsonText = await therapyChatWithOpenAI({
        apiKey: OPENAI_API_KEY,
        model: OPENAI_MODEL,
        payload: validation.payload,
      });
    } catch (e) {
      console.error("[therapy/chat] OpenAI error:", {
        requestId,
        code: e.code || "UNKNOWN",
        status: e.openaiStatus || e.status || 500,
      });
      logTherapyRequest(requestId, 500, startedAt);
      return res.status(500).json({
        error: "upstream_failure",
        message: "Failed to complete therapy chat response",
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(modelJsonText);
    } catch {
      console.error("[therapy/chat] Model output was not JSON", { requestId });
      logTherapyRequest(requestId, 422, startedAt);
      return res.status(422).json({
        error: "parse_failure",
        message: "Model returned data that could not be parsed as JSON",
      });
    }

    if (!hasValidTherapyResponseShape(parsed)) {
      logTherapyRequest(requestId, 422, startedAt);
      return res.status(422).json({
        error: "validation_failure",
        message: "Therapy response did not match the expected schema",
      });
    }

    const normalized = normalizeTherapyResponse(parsed);
    logTherapyRequest(requestId, 200, startedAt);
    return res.status(200).json(normalized);
  } catch (err) {
    console.error("[therapy/chat] Unexpected:", {
      requestId,
      message: err?.message || "Unexpected server error",
    });
    logTherapyRequest(requestId, 500, startedAt);
    return res.status(500).json({
      error: "internal_error",
      message: "Unexpected server error",
    });
  }
});

app.post("/parse-food-label", upload.single("image"), async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error: "server_misconfiguration",
        message: "OPENAI_API_KEY is not set",
      });
    }

    const file = req.file;
    if (!file || !file.buffer?.length) {
      return res.status(400).json({
        error: "missing_image",
        message: 'Multipart field "image" with an image file is required',
      });
    }

    const mimeType = file.mimetype || "image/jpeg";
    if (!mimeType.startsWith("image/")) {
      return res.status(400).json({
        error: "invalid_image_type",
        message: "Uploaded file must be an image/* MIME type",
      });
    }

    let modelJsonText;
    try {
      modelJsonText = await extractFoodLabelWithOpenAI({
        apiKey: OPENAI_API_KEY,
        model: OPENAI_MODEL,
        imageBuffer: file.buffer,
        mimeType,
      });
    } catch (e) {
      console.error("[parse-food-label] OpenAI error:", e.message);
      if (e.code === "OPENAI_REFUSAL") {
        return res.status(422).json({
          error: "analysis_refused",
          message: "The image could not be analyzed. Try a clearer label photo.",
        });
      }
      return res.status(500).json({
        error: "upstream_failure",
        message: "Failed to complete label analysis",
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(modelJsonText);
    } catch {
      console.error("[parse-food-label] Model output was not JSON");
      return res.status(422).json({
        error: "parse_failure",
        message: "Model returned data that could not be parsed as JSON",
      });
    }

    if (!hasValidLabelShape(parsed)) {
      return res.status(422).json({
        error: "validation_failure",
        message: "Parsed object did not match the expected label schema",
      });
    }

    const normalized = normalizeParsedLabel(parsed);
    return res.status(200).json(normalized);
  } catch (err) {
    console.error("[parse-food-label] Unexpected:", err);
    return res.status(500).json({
      error: "internal_error",
      message: "Unexpected server error",
    });
  }
});

app.use((err, _req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "invalid_json",
      message: "Request body must be valid JSON",
    });
  }
  if (err && err.type === "entity.too.large") {
    return res.status(400).json({
      error: "body_too_large",
      message: "Request body is too large",
    });
  }
  if (err && err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "file_too_large",
        message: "Image exceeds maximum upload size",
      });
    }
    return res.status(400).json({
      error: "upload_error",
      message: err.message || "Multipart upload failed",
    });
  }
  return next(err);
});

app.listen(PORT, () => {
  console.log(`Food label API listening on http://127.0.0.1:${PORT}`);
});

function logTherapyRequest(requestId, status, startedAt) {
  console.log("[therapy/chat]", {
    requestId,
    status,
    durationMs: Date.now() - startedAt,
  });
}

function validateAndSanitizeTherapyRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      error: "invalid_body",
      message: "JSON object body is required",
    };
  }

  const userMessage = truncateText(body.userMessage, 4_000).trim();
  if (!userMessage) {
    return {
      ok: false,
      error: "missing_user_message",
      message: "userMessage is required",
    };
  }

  const payload = {
    userMessage,
    selectedDay: sanitizeOptionalString(body.selectedDay, 80),
    recentMessages: sanitizeRecentMessages(body.recentMessages),
    memoryNotes: sanitizeMemoryNotes(body.memoryNotes),
    therapyProfile: sanitizeTherapyProfile(body.therapyProfile),
    dayContext: sanitizeDayContext(body.dayContext),
  };

  return { ok: true, payload };
}

function sanitizeRecentMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-30).map((message) => ({
    role: sanitizeRole(message?.role),
    text: truncateText(message?.text, 2_000),
    createdAt: sanitizeOptionalString(message?.createdAt, 80),
    linkedDay: sanitizeOptionalString(message?.linkedDay, 80),
  })).filter((message) => message.text.trim());
}

function sanitizeMemoryNotes(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((note) => ({
    title: truncateText(note?.title, 160),
    text: truncateText(note?.text, 1_200),
    tags: sanitizeStringArray(note?.tags, 12, 40),
    importance: sanitizeImportance(note?.importance),
  })).filter((note) => note.title.trim() || note.text.trim());
}

function sanitizeTherapyProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return {
    systemPrompt: truncateText(value.systemPrompt, 3_000),
    communicationStyle: truncateText(value.communicationStyle, 1_500),
    memoryRules: truncateText(value.memoryRules, 1_500),
    forbiddenBehaviors: sanitizeStringArray(value.forbiddenBehaviors, 30, 160),
  };
}

function sanitizeDayContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return sanitizeJson(value, 4, 8_000);
}

function sanitizeJson(value, depth, maxStringLength) {
  if (depth <= 0) return null;
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return truncateText(value, maxStringLength);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeJson(item, depth - 1, maxStringLength));
  }
  if (typeof value === "object") {
    const result = {};
    for (const [key, nested] of Object.entries(value).slice(0, 40)) {
      result[truncateText(key, 80)] = sanitizeJson(nested, depth - 1, maxStringLength);
    }
    return result;
  }
  return null;
}

function sanitizeRole(value) {
  if (value === "assistant" || value === "system") return value;
  return "user";
}

function sanitizeOptionalString(value, maxLength) {
  if (typeof value !== "string") return null;
  const text = truncateText(value, maxLength).trim();
  return text || null;
}

function sanitizeStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => truncateText(item, maxLength).trim())
    .filter(Boolean);
}

function sanitizeImportance(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function truncateText(value, maxLength) {
  if (typeof value !== "string") return "";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}

function hasValidTherapyResponseShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value.assistantMessage !== "string" || !value.assistantMessage.trim()) return false;
  const suggestion = value.memorySuggestion;
  if (suggestion === null || suggestion === undefined) return true;
  if (typeof suggestion !== "object" || Array.isArray(suggestion)) return false;
  return typeof suggestion.title === "string"
    && typeof suggestion.text === "string"
    && Array.isArray(suggestion.tags)
    && (suggestion.importance === null || suggestion.importance === undefined || typeof suggestion.importance === "number")
    && (suggestion.reason === null || suggestion.reason === undefined || typeof suggestion.reason === "string");
}

function normalizeTherapyResponse(value) {
  let memorySuggestion = null;
  if (value.memorySuggestion && typeof value.memorySuggestion === "object") {
    memorySuggestion = {
      title: truncateText(value.memorySuggestion.title, 160).trim(),
      text: truncateText(value.memorySuggestion.text, 1_200).trim(),
      tags: sanitizeStringArray(value.memorySuggestion.tags, 12, 40),
      importance: sanitizeImportance(value.memorySuggestion.importance),
      reason: sanitizeOptionalString(value.memorySuggestion.reason, 400),
    };
    if (!memorySuggestion.title || !memorySuggestion.text) {
      memorySuggestion = null;
    }
  }

  return {
    assistantMessage: truncateText(value.assistantMessage, 6_000).trim(),
    memorySuggestion,
  };
}
