import 'dotenv/config';
import express from "express";
import multer from "multer";
import { extractFoodLabelWithOpenAI } from "./openai.js";
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

app.get("/health", (_req, res) => {
  res.json({ ok: true });
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
