import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import {
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_PROD,
  type AntigravityToken,
} from "./antigravity.js";

const decode = (value: string): string => Buffer.from(value, "base64").toString();
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "YOUR_CLIENT_ID_PLACEHOLDER";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "YOUR_CLIENT_SECRET_PLACEHOLDER";

const REDIRECT_URI = "http://localhost:51121/oauth-callback";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_PROJECT_ID = "rising-fact-p41fc";

const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

const RESPONSE_PAGE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Khalid AI Antigravity OAuth</title>
  </head>
  <body>
    <main>
      <h1>Authentication complete</h1>
      <p>You can return to the terminal.</p>
    </main>
  </body>
</html>`;

export type AntigravityOAuthToken = AntigravityToken;

function generatePkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(32).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");
  return { verifier, challenge, state };
}

function buildAuthUrl(params: { challenge: string; state: string }): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

function parseCallbackInput(input: string): { code: string; state: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { error: "No input provided" };
  }

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code) {
      return { error: "Missing 'code' parameter in URL" };
    }
    if (!state) {
      return { error: "Missing 'state' parameter in URL" };
    }
    return { code, state };
  } catch {
    return { error: "Paste the full redirect URL (not just code)." };
  }
}

async function startCallbackServer(params: { timeoutMs: number }) {
  const redirect = new URL(REDIRECT_URI);
  const port = redirect.port ? Number(redirect.port) : 51121;

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
    rejectCallback(new Error("Timed out waiting for OAuth callback"));
  }, params.timeoutMs);
  timeout.unref?.();

  const server = createServer((request, response) => {
    if (!request.url) {
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end("Missing URL");
      return;
    }

    const url = new URL(request.url, `${redirect.protocol}//${redirect.host}`);
    if (url.pathname !== redirect.pathname) {
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

async function exchangeCode(params: {
  code: string;
  verifier: string;
}): Promise<{ access: string; refresh: string; expires: number }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: params.code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      code_verifier: params.verifier,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${text || response.statusText}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new Error("Token exchange returned no access_token");
  }
  if (!data.refresh_token) {
    throw new Error("Token exchange returned no refresh_token");
  }

  return {
    access: data.access_token,
    refresh: data.refresh_token,
    expires: Date.now() + (data.expires_in || 0) * 1000 - 5 * 60 * 1000,
  };
}

async function fetchUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as { email?: string };
    return data.email;
  } catch {
    return undefined;
  }
}

async function fetchProjectInfo(accessToken: string): Promise<{ projectId: string; baseUrl: string }> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "google-api-nodejs-client/9.15.1",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    }),
  };

  const endpoints = [ANTIGRAVITY_ENDPOINT_PROD, ANTIGRAVITY_ENDPOINT_DAILY];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
      });

      if (!response.ok) {
        continue;
      }

      const data = (await response.json()) as {
        cloudaicompanionProject?: string | { id?: string };
      };

      const project = data.cloudaicompanionProject;
      if (typeof project === "string" && project.trim()) {
        return { projectId: project, baseUrl: endpoint };
      }
      if (project && typeof project === "object" && typeof project.id === "string" && project.id.trim()) {
        return { projectId: project.id, baseUrl: endpoint };
      }
    } catch {
      // try next endpoint
    }
  }

  return {
    projectId: DEFAULT_PROJECT_ID,
    baseUrl: ANTIGRAVITY_ENDPOINT_DAILY,
  };
}

export async function loginAntigravityPortalOAuth(params: {
  isRemote?: boolean;
  openUrl: (url: string) => Promise<void>;
  prompt: (message: string) => Promise<string>;
  note: (message: string, title?: string) => Promise<void>;
  progress: { update: (message: string) => void; stop: (message?: string) => void };
}): Promise<AntigravityOAuthToken> {
  const { verifier, challenge, state } = generatePkce();
  const authUrl = buildAuthUrl({ challenge, state });

  let callbackServer: Awaited<ReturnType<typeof startCallbackServer>> | null = null;
  const needsManual = Boolean(params.isRemote);

  if (!needsManual) {
    try {
      callbackServer = await startCallbackServer({ timeoutMs: 5 * 60 * 1000 });
    } catch {
      callbackServer = null;
    }
  }

  await params.note(
    callbackServer
      ? [
        "Browser login window will open.",
        "Complete Google sign-in, then CLI will continue automatically.",
        `If browser does not open, use this URL:\n${authUrl}`,
      ].join("\n")
      : [
        "Open the URL in your local browser.",
        "After login, copy full redirect URL and paste below.",
        "",
        `Auth URL: ${authUrl}`,
        `Redirect URI: ${REDIRECT_URI}`,
      ].join("\n"),
    "Google Antigravity OAuth",
  );

  try {
    await params.openUrl(authUrl);
  } catch {
    // manual fallback available
  }

  let code = "";
  let returnedState = "";

  if (callbackServer) {
    params.progress.update("Waiting for OAuth callback...");
    const callback = await callbackServer.waitForCallback();
    code = callback.searchParams.get("code") || "";
    returnedState = callback.searchParams.get("state") || "";
    await callbackServer.close();
  } else {
    params.progress.update("Waiting for redirect URL...");
    const input = await params.prompt("Paste redirect URL: ");
    const parsed = parseCallbackInput(input);
    if ("error" in parsed) {
      throw new Error(parsed.error);
    }
    code = parsed.code;
    returnedState = parsed.state;
  }

  if (!code) {
    throw new Error("Missing OAuth code");
  }
  if (returnedState !== state) {
    throw new Error("OAuth state mismatch. Please try again.");
  }

  params.progress.update("Exchanging code for token...");
  const token = await exchangeCode({ code, verifier });

  params.progress.update("Fetching account info...");
  const email = await fetchUserEmail(token.access);

  params.progress.update("Detecting Antigravity project...");
  const project = await fetchProjectInfo(token.access);

  params.progress.stop("Antigravity OAuth complete");
  return {
    ...token,
    email,
    projectId: project.projectId,
    baseUrl: project.baseUrl,
  };
}
