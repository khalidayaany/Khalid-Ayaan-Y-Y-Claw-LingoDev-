import {
  emptyPluginConfigSchema,
  type OpenClawPluginApi,
  type ProviderAuthContext,
  type ProviderAuthResult,
} from "openclaw/plugin-sdk";
import { loginCodexOAuth } from "./oauth.js";

const PROVIDER_ID = "codex-cli";
const PROVIDER_LABEL = "Codex";
const DEFAULT_MODEL = "gpt-5.3-codex";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_CONTEXT_WINDOW = 256000;
const DEFAULT_MAX_TOKENS = 32768;
const OAUTH_PLACEHOLDER = "codex-cli-auth";

function modelRef(modelId: string): string {
  return `${PROVIDER_ID}/${modelId}`;
}

function buildModelDefinition(params: {
  id: string;
  name: string;
  input: Array<"text" | "image">;
  reasoning?: boolean;
}) {
  return {
    id: params.id,
    name: params.name,
    reasoning: params.reasoning ?? false,
    input: params.input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

function createOAuthHandler() {
  return async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
    const progress = ctx.prompter.progress("Starting Codex OAuth...");
    try {
      const result = await loginCodexOAuth({
        note: ctx.prompter.note,
        progress,
      });

      progress.stop("Codex OAuth complete");

      const profileId = `${PROVIDER_ID}:default`;

      return {
        profiles: [
          {
            profileId,
            credential: {
              type: "oauth" as const,
              provider: PROVIDER_ID,
              access: OAUTH_PLACEHOLDER,
              refresh: OAUTH_PLACEHOLDER,
              expires: Date.now() + 24 * 60 * 60 * 1000,
            },
          },
        ],
        configPatch: {
          models: {
            providers: {
              [PROVIDER_ID]: {
                baseUrl: DEFAULT_BASE_URL,
                apiKey: OAUTH_PLACEHOLDER,
                api: "openai-chat-completions",
                models: [
                  buildModelDefinition({
                    id: "gpt-5.3-codex",
                    name: "gpt-5.3-codex",
                    input: ["text"],
                    reasoning: true,
                  }),
                  buildModelDefinition({
                    id: "gpt-5.2-codex",
                    name: "gpt-5.2-codex",
                    input: ["text"],
                    reasoning: true,
                  }),
                ],
              },
            },
          },
          agents: {
            defaults: {
              models: {
                [modelRef("gpt-5.3-codex")]: { alias: "codex" },
                [modelRef("gpt-5.2-codex")]: { alias: "codex-fast" },
              },
            },
          },
        },
        defaultModel: modelRef(DEFAULT_MODEL),
        notes: [
          "Codex auth is managed by local codex CLI login.",
          `Auth mode: ${result.token.authMode}`,
          `Base URL defaults to ${DEFAULT_BASE_URL}.`,
        ],
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      progress.stop(`Codex OAuth failed: ${errorMsg}`);
      throw err;
    }
  };
}

const codexCliPlugin = {
  id: "codex-cli-auth",
  name: "Codex OAuth",
  description: "Auth flow for Codex via local codex CLI",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      docsPath: "/providers/codex",
      aliases: ["codex", "openai-codex"],
      auth: [
        {
          id: "oauth",
          label: "Codex OAuth",
          hint: "Uses local codex login",
          kind: "device_code",
          run: createOAuthHandler(),
        },
      ],
    });
  },
};

export default codexCliPlugin;
