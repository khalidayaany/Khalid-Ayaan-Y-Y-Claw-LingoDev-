#!/usr/bin/env bun

import {
  getOpenRouterModels,
  loadOpenRouterToken,
  resolveOpenRouterBaseUrl,
  type OpenRouterModel,
} from "../../Cli-Extenshone/Openrouter/openrouter.js";
import {
  getQwenModels,
  loadQwenToken,
  resolveQwenBaseUrl,
  type QwenModel,
} from "../../Cli-Extenshone/Qwen/qwen.js";
import { telegramDownloadFileById } from "../../Cli-Extenshone/Telegram/telegram.js";
import { analyzeBinaryWithAntigravity } from "../Voise/voise.js";

export type PhotoAnalysisResult = {
  analysis: string;
  provider: "openrouter" | "qwen" | "antigravity";
  model: string;
};

function toDataUri(buffer: Buffer, mimeType = "image/jpeg"): string {
  const encoded = buffer.toString("base64");
  return `data:${mimeType};base64,${encoded}`;
}

function inferImageMime(filePath?: string): string {
  const lower = (filePath || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function pickOpenRouterVisionModel(models: OpenRouterModel[]): OpenRouterModel | undefined {
  const vision = models.find((model) => model.input.includes("image"));
  if (vision) return vision;
  return models.find((model) => {
    const lower = `${model.id} ${model.name}`.toLowerCase();
    return (
      lower.includes("vision") ||
      lower.includes("gemini") ||
      lower.includes("gpt-4o") ||
      lower.includes("claude")
    );
  });
}

function pickQwenVisionModel(models: QwenModel[]): QwenModel | undefined {
  const exactVision = models.find((model) => {
    const lower = `${model.id} ${model.name}`.toLowerCase();
    return lower.includes("vision") || lower.includes("vl");
  });
  return exactVision || models[0];
}

async function analyzeWithOpenRouter(params: {
  imageDataUri: string;
  prompt: string;
}): Promise<PhotoAnalysisResult> {
  const token = await loadOpenRouterToken();
  if (!token) {
    throw new Error("OpenRouter is not authenticated.");
  }

  const models = await getOpenRouterModels(token);
  const model = pickOpenRouterVisionModel(models);
  if (!model) {
    throw new Error("No OpenRouter vision model available.");
  }

  const response = await fetch(`${resolveOpenRouterBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.apiKey}`,
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://localhost",
      "X-Title": process.env.OPENROUTER_X_TITLE || "Khalid AI CLI",
    },
    body: JSON.stringify({
      model: model.id,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: params.prompt },
            {
              type: "image_url",
              image_url: { url: params.imageDataUri },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const analysis = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!analysis) {
    throw new Error("OpenRouter returned empty image analysis.");
  }

  return {
    analysis,
    provider: "openrouter",
    model: model.id,
  };
}

async function analyzeWithQwen(params: {
  imageDataUri: string;
  prompt: string;
}): Promise<PhotoAnalysisResult> {
  const token = await loadQwenToken();
  if (!token) {
    throw new Error("Qwen is not authenticated.");
  }

  const models = await getQwenModels(token);
  const model = pickQwenVisionModel(models);
  if (!model) {
    throw new Error("No Qwen model available.");
  }

  const response = await fetch(`${resolveQwenBaseUrl(token)}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.access}`,
    },
    body: JSON.stringify({
      model: model.id,
      max_tokens: Math.min(model.maxTokens, 1024),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: params.prompt },
            {
              type: "image_url",
              image_url: { url: params.imageDataUri },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const analysis = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!analysis) {
    throw new Error("Qwen returned empty image analysis.");
  }

  return {
    analysis,
    provider: "qwen",
    model: model.id,
  };
}

export async function analyzeTelegramPhoto(params: {
  telegramToken: string;
  fileId: string;
  prompt: string;
}): Promise<PhotoAnalysisResult> {
  const downloaded = await telegramDownloadFileById(params.telegramToken, params.fileId);
  const mimeType = inferImageMime(downloaded.fileInfo.file_path);
  const imageDataUri = toDataUri(downloaded.buffer, mimeType);
  const errors: string[] = [];

  try {
    return await analyzeWithOpenRouter({
      imageDataUri,
      prompt: params.prompt,
    });
  } catch (openRouterError: any) {
    errors.push(openRouterError?.message || "OpenRouter failed");
  }

  try {
    return await analyzeWithQwen({
      imageDataUri,
      prompt: params.prompt,
    });
  } catch (qwenError: any) {
    errors.push(qwenError?.message || "Qwen failed");
  }

  try {
    const antigravity = await analyzeBinaryWithAntigravity({
      fileBuffer: downloaded.buffer,
      mimeType,
      prompt: params.prompt,
    });
    return {
      analysis: antigravity.text,
      provider: "antigravity",
      model: antigravity.model,
    };
  } catch (antigravityError: any) {
    errors.push(antigravityError?.message || "Antigravity failed");
  }

  throw new Error(`Image analysis failed. ${errors.join(" | ")}`);
}
