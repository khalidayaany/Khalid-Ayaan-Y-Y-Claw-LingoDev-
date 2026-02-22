#!/usr/bin/env bun

import { analyzeTelegramPhoto } from "../Photo/photo.js";
import { analyzeBinaryWithAntigravity, transcribeBinaryWithOpenRouter } from "../Voise/voise.js";
import { telegramDownloadFileById } from "../../Cli-Extenshone/Telegram/telegram.js";

export type VideoDecodeResult = {
  transcript?: string;
  transcriptModel?: string;
  visualSummary?: string;
  visualModel?: string;
  directVideoSummary?: string;
  directVideoModel?: string;
  metadataSummary: string;
};

function inferMimeFromPath(filePath?: string): string {
  const lower = (filePath || "").toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  return "video/mp4";
}

function fileNameFromPath(filePath?: string, fallback = "video.mp4"): string {
  const value = (filePath || "").split("/").filter(Boolean).pop();
  return value || fallback;
}

export async function decodeTelegramVideo(params: {
  telegramToken: string;
  videoFileId: string;
  thumbnailFileId?: string;
  durationSec?: number;
  caption?: string;
}): Promise<VideoDecodeResult> {
  const downloaded = await telegramDownloadFileById(params.telegramToken, params.videoFileId);
  const fileName = fileNameFromPath(downloaded.fileInfo.file_path);
  const mimeType = inferMimeFromPath(downloaded.fileInfo.file_path);

  let transcript = "";
  let transcriptModel = "";
  let visualSummary = "";
  let visualModel = "";
  let directVideoSummary = "";
  let directVideoModel = "";

  try {
    const transcribed = await transcribeBinaryWithOpenRouter({
      fileBuffer: downloaded.buffer,
      fileName,
      mimeType,
    });
    transcript = transcribed.transcript;
    transcriptModel = transcribed.model;
  } catch {
    transcript = "";
    transcriptModel = "";
  }

  if (!transcript) {
    try {
      const summarized = await analyzeBinaryWithAntigravity({
        fileBuffer: downloaded.buffer,
        mimeType,
        prompt:
          "Summarize this video. Include key events, key entities, and spoken content if present. Keep the summary practical and concise.",
      });
      directVideoSummary = summarized.text;
      directVideoModel = summarized.model;
    } catch {
      directVideoSummary = "";
      directVideoModel = "";
    }
  }

  if (params.thumbnailFileId) {
    try {
      const photoResult = await analyzeTelegramPhoto({
        telegramToken: params.telegramToken,
        fileId: params.thumbnailFileId,
        prompt:
          "Analyze this video preview frame. Describe key visual scene, main subjects, and likely context.",
      });
      visualSummary = photoResult.analysis;
      visualModel = `${photoResult.provider}/${photoResult.model}`;
    } catch {
      visualSummary = "";
      visualModel = "";
    }
  }

  const metadataParts: string[] = [
    `File: ${fileName}`,
    `MIME: ${mimeType}`,
    `Size: ${downloaded.fileInfo.file_size ?? "unknown"} bytes`,
  ];

  if (typeof params.durationSec === "number") {
    metadataParts.push(`Duration: ${params.durationSec}s`);
  }
  if (params.caption?.trim()) {
    metadataParts.push(`Caption: ${params.caption.trim()}`);
  }

  return {
    transcript: transcript || undefined,
    transcriptModel: transcriptModel || undefined,
    visualSummary: visualSummary || undefined,
    visualModel: visualModel || undefined,
    directVideoSummary: directVideoSummary || undefined,
    directVideoModel: directVideoModel || undefined,
    metadataSummary: metadataParts.join("\n"),
  };
}
