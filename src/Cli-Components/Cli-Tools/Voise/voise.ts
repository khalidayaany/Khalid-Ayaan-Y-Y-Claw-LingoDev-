#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import {
  getAntigravityModels,
  loadAntigravityToken,
  normalizeAntigravityModelId,
  resolveAntigravityBaseUrl,
  type AntigravityModel,
} from "../../Cli-Extenshone/Antigravity/antigravity.js";
import { loadOpenRouterToken, resolveOpenRouterBaseUrl } from "../../Cli-Extenshone/Openrouter/openrouter.js";
import { telegramDownloadFileById } from "../../Cli-Extenshone/Telegram/telegram.js";

const TRANSCRIPTION_MODELS = [
  "openai/whisper-1",
  "gpt-4o-mini-transcribe",
  "gpt-4o-transcribe",
];

export type MediaTranscriptionResult = {
  transcript: string;
  model: string;
  provider: "openrouter" | "antigravity";
};

function fileNameFromPath(pathValue?: string, fallback = "media.bin"): string {
  if (!pathValue) return fallback;
  const normalized = pathValue.split("/").filter(Boolean).pop();
  return normalized || fallback;
}

function inferMimeFromName(fileName: string, fallback = "application/octet-stream"): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".oga")) return "audio/ogg";
  if (lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  return fallback;
}

function extractTranscriptionText(payload: any): string {
  const direct = [
    payload?.text,
    payload?.transcript,
    payload?.output_text,
    payload?.result?.text,
    payload?.data?.text,
  ]
    .find((value) => typeof value === "string" && value.trim().length > 0);

  if (typeof direct === "string") {
    return direct.trim();
  }

  if (Array.isArray(payload?.segments)) {
    const joined = payload.segments
      .map((segment: any) => (typeof segment?.text === "string" ? segment.text : ""))
      .join(" ")
      .trim();
    if (joined) {
      return joined;
    }
  }

  return "";
}

function getAntigravityHeaders(): Record<string, string> {
  const version = process.env.PI_AI_ANTIGRAVITY_VERSION || "1.15.8";
  return {
    "User-Agent": `antigravity/${version} darwin/arm64`,
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    }),
  };
}

function parseAntigravitySseText(rawSse: string): string {
  let output = "";
  const lines = rawSse.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    let chunk: any;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }

    const parts = chunk?.response?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.length > 0) {
        output += part.text;
      }
    }
  }
  return output.trim();
}

function pickGeminiModel(models: AntigravityModel[]): AntigravityModel | undefined {
  return (
    models.find((model) => `${model.id} ${model.name}`.toLowerCase().includes("gemini")) ||
    models[0]
  );
}

export async function analyzeBinaryWithAntigravity(params: {
  fileBuffer: Buffer;
  mimeType: string;
  prompt: string;
}): Promise<{ text: string; model: string }> {
  const token = await loadAntigravityToken();
  if (!token) {
    throw new Error("Antigravity is not authenticated.");
  }

  const models = await getAntigravityModels(token);
  if (!models.length) {
    throw new Error("No Antigravity model available.");
  }

  const model = pickGeminiModel(models);
  if (!model) {
    throw new Error("No Antigravity Gemini model available.");
  }

  const response = await fetch(`${resolveAntigravityBaseUrl(token)}/v1internal:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...getAntigravityHeaders(),
    },
    body: JSON.stringify({
      project: token.projectId,
      model: normalizeAntigravityModelId(model.id),
      request: {
        contents: [
          {
            role: "user",
            parts: [
              { text: params.prompt },
              {
                inlineData: {
                  mimeType: params.mimeType,
                  data: params.fileBuffer.toString("base64"),
                },
              },
            ],
          },
        ],
      },
      requestType: "agent",
      userAgent: "antigravity",
      requestId: `agent-${Date.now()}-${randomUUID().slice(0, 8)}`,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  const rawSse = await response.text();
  const text = parseAntigravitySseText(rawSse);
  if (!text) {
    throw new Error("Antigravity returned empty multimodal response.");
  }

  return {
    text,
    model: model.id,
  };
}

export async function transcribeBinaryWithOpenRouter(params: {
  fileBuffer: Buffer;
  fileName: string;
  mimeType?: string;
}): Promise<MediaTranscriptionResult> {
  const mimeType = params.mimeType || inferMimeFromName(params.fileName);
  const openRouterToken = await loadOpenRouterToken();
  const baseUrl = resolveOpenRouterBaseUrl();
  const errors: string[] = [];

  if (openRouterToken) {
    for (const model of TRANSCRIPTION_MODELS) {
      try {
        const formData = new FormData();
        formData.set("model", model);
        const bytes = Uint8Array.from(params.fileBuffer);
        formData.set(
          "file",
          new File([bytes], params.fileName, {
            type: mimeType,
          }),
        );

        const response = await fetch(`${baseUrl}/audio/transcriptions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openRouterToken.apiKey}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const text = await response.text();
          errors.push(`OpenRouter ${model}: ${text || `${response.status} ${response.statusText}`}`);
          continue;
        }

        let payload: any = null;
        try {
          payload = await response.json();
        } catch {
          const text = (await response.text()).trim();
          if (text) {
            return {
              transcript: text,
              model,
              provider: "openrouter",
            };
          }
        }

        const transcript = extractTranscriptionText(payload);
        if (transcript) {
          return {
            transcript,
            model,
            provider: "openrouter",
          };
        }

        errors.push(`OpenRouter ${model}: empty transcript`);
      } catch (error: any) {
        errors.push(`OpenRouter ${model}: ${error?.message || "request failed"}`);
      }
    }
  } else {
    errors.push("OpenRouter not authenticated");
  }

  try {
    const antigravity = await analyzeBinaryWithAntigravity({
      fileBuffer: params.fileBuffer,
      mimeType,
      prompt:
        "Transcribe the speech from this audio or video exactly. Return plain text transcript only. If unclear, do best effort.",
    });
    return {
      transcript: antigravity.text,
      model: antigravity.model,
      provider: "antigravity",
    };
  } catch (error: any) {
    errors.push(`Antigravity: ${error?.message || "request failed"}`);
  }

  throw new Error(errors.join(" | "));
}

export async function transcribeTelegramVoice(params: {
  telegramToken: string;
  fileId: string;
  mimeTypeHint?: string;
  fileNameHint?: string;
}): Promise<MediaTranscriptionResult> {
  const downloaded = await telegramDownloadFileById(params.telegramToken, params.fileId);
  const fileName =
    params.fileNameHint || fileNameFromPath(downloaded.fileInfo.file_path, "voice.ogg");
  const mimeType = params.mimeTypeHint || inferMimeFromName(fileName, "audio/ogg");

  return await transcribeBinaryWithOpenRouter({
    fileBuffer: downloaded.buffer,
    fileName,
    mimeType,
  });
}
