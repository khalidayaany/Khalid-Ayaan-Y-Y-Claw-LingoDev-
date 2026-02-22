import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

export type OpenRouterOAuthToken = {
  apiKey: string;
  userId?: string;
  createdAt: number;
};

const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
const OPENROUTER_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";

const CALLBACK_PORT = Number(process.env.OPENROUTER_OAUTH_PORT || 3000);
const CALLBACK_PATH = process.env.OPENROUTER_OAUTH_CALLBACK_PATH || "/openrouter-oauth-callback";
const CALLBACK_URL =
  process.env.OPENROUTER_OAUTH_CALLBACK_URL?.trim() || `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

const RESPONSE_PAGE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Khalid AI OpenRouter OAuth</title>
  </head>
  <body>
    <main>
      <h1>Authentication complete</h1>
      <p>You can return to the terminal.</p>
    </main>
  </body>
</html>`;

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function buildAuthUrl(callbackUrl: string, challenge: string): string {
  const url = new URL(OPENROUTER_AUTH_URL);
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function parseCallbackFromUrl(url: URL): { code: string } | { error: string } {
  const code = url.searchParams.get("code");

  if (!code) {
    return { error: "No 'code' query parameter found in redirect URL." };
  }

  return { code };
}

function parseManualCallbackInput(input: string): { code: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { error: "No redirect URL provided." };
  }

  try {
    const url = new URL(trimmed);
    return parseCallbackFromUrl(url);
  } catch {
    return { error: "Paste the full redirect URL (not only the code)." };
  }
}

function canStartLocalCallbackServer(callbackUrl: string): boolean {
  try {
    const url = new URL(callbackUrl);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

async function startCallbackServer(params: { timeoutMs: number; callbackUrl: string }) {
  const base = new URL(params.callbackUrl);
  const port =
    base.port && Number(base.port) > 0
      ? Number(base.port)
      : base.protocol === "https:"
        ? 443
        : 80;

  let settled = false;
  let resolveCallback!: (url: URL) => void;
  let rejectCallback!: (error: Error) => void;

  const callbackPromise = new Promise<URL>((resolve, reject) => {
    resolveCallback = (url) => {
      if (settled) return;
      settled = true;
      resolve(url);
    };
    rejectCallback = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
  });

  const timeout = setTimeout(() => {
    rejectCallback(new Error("Timed out while waiting for OAuth callback."));
  }, params.timeoutMs);
  timeout.unref?.();

  const server = createServer((request, response) => {
    if (!request.url) {
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end("Missing URL");
      return;
    }

    const url = new URL(request.url, `${base.protocol}//${base.host}`);
    if (url.pathname !== base.pathname) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(RESPONSE_PAGE);
    resolveCallback(url);

    setImmediate(() => {
      server.close();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };

    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  return {
    waitForCallback: () => callbackPromise,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function exchangeAuthCode(params: { code: string; verifier: string }): Promise<OpenRouterOAuthToken> {
  const appApiKey = process.env.OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER_APP_API_KEY?.trim() || "";

  const attempts: Array<string | undefined> = [undefined];
  if (appApiKey) {
    attempts.push(appApiKey);
  }

  let lastError = "OpenRouter key exchange failed";

  for (const appKey of attempts) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (appKey) {
      headers.Authorization = `Bearer ${appKey}`;
    }

    const response = await fetch(OPENROUTER_EXCHANGE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        code: params.code,
        code_verifier: params.verifier,
        code_challenge_method: "S256",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      lastError = text || `${response.status} ${response.statusText}`;
      continue;
    }

    const payload = (await response.json()) as {
      key?: string;
      user_id?: string;
    };

    if (!payload.key || !payload.key.trim()) {
      lastError = "OpenRouter response did not include an API key.";
      continue;
    }

    return {
      apiKey: payload.key.trim(),
      userId: payload.user_id?.trim(),
      createdAt: Date.now(),
    };
  }

  throw new Error(lastError);
}

export async function loginOpenRouterOAuth(params: {
  isRemote?: boolean;
  openUrl: (url: string) => Promise<void>;
  prompt: (message: string) => Promise<string>;
  note: (message: string, title?: string) => Promise<void>;
  progress: { update: (message: string) => void; stop: (message?: string) => void };
}): Promise<OpenRouterOAuthToken> {
  const { verifier, challenge } = generatePkce();
  const callbackUrl = CALLBACK_URL;
  const authUrl = buildAuthUrl(callbackUrl, challenge);

  let callbackServer: Awaited<ReturnType<typeof startCallbackServer>> | null = null;
  const needsManual = Boolean(params.isRemote) || !canStartLocalCallbackServer(callbackUrl);

  if (!needsManual) {
    try {
      callbackServer = await startCallbackServer({ timeoutMs: 5 * 60 * 1000, callbackUrl });
    } catch {
      callbackServer = null;
    }
  }

  await params.note(
    callbackServer
      ? [
          "A browser login window will open.",
          "After OpenRouter authorization, CLI will continue automatically.",
          "Use a stable localhost callback to avoid app registration conflicts.",
          `If browser auto-open fails, open this URL manually:\n${authUrl}`,
        ].join("\n")
      : [
          "Open the OpenRouter auth URL in your browser.",
          "After login/approval, copy the full redirect URL and paste it here.",
          "",
          `Auth URL: ${authUrl}`,
          `Callback URL: ${callbackUrl}`,
        ].join("\n"),
    "OpenRouter OAuth",
  );

  try {
    await params.openUrl(authUrl);
  } catch {
    // manual fallback available
  }

  let code = "";

  if (callbackServer) {
    params.progress.update("Waiting for OpenRouter callback...");
    const callback = await callbackServer.waitForCallback();
    const parsed = parseCallbackFromUrl(callback);
    await callbackServer.close();

    if ("error" in parsed) {
      throw new Error(parsed.error);
    }

    code = parsed.code;
  } else {
    params.progress.update("Waiting for redirect URL...");
    const input = await params.prompt("Paste redirect URL: ");
    const parsed = parseManualCallbackInput(input);

    if ("error" in parsed) {
      throw new Error(parsed.error);
    }

    code = parsed.code;
  }

  if (!code) {
    throw new Error("Missing OAuth code in callback URL.");
  }

  params.progress.update("Exchanging OpenRouter auth code for API key...");
  const token = await exchangeAuthCode({ code, verifier });

  params.progress.stop("OpenRouter OAuth complete");
  return token;
}
