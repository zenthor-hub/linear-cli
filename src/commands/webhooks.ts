import { resolveCredential } from "../config.ts";
import { ConfigError } from "../errors.ts";
import { executeGraphql } from "../graphql/client.ts";
import {
  WEBHOOK_CREATE,
  WEBHOOK_DELETE,
  WEBHOOK_QUERY,
  WEBHOOKS_QUERY,
  type Webhook,
  type WebhookCreateResult,
  type WebhookDeleteResult,
  type WebhookResult,
  type WebhooksResult,
} from "../graphql/documents.ts";
import { fetchAllNodes } from "../graphql/paginate.ts";
import { redactUrlSecrets } from "../output/redact.ts";

function redactWebhook(webhook: Webhook): Webhook {
  return { ...webhook, url: redactUrlSecrets(webhook.url) };
}

function redactWebhookInput(input: Record<string, unknown>): Record<string, unknown> {
  return typeof input.url === "string" ? { ...input, url: redactUrlSecrets(input.url) } : input;
}

export async function listWebhooks(opts: { debug?: boolean }): Promise<Webhook[]> {
  const credential = await resolveCredential();
  const webhooks = await fetchAllNodes<Webhook, WebhooksResult>(
    WEBHOOKS_QUERY,
    (data) => data.webhooks,
    {
      credential,
      debug: opts.debug,
    },
  );
  return webhooks.map(redactWebhook);
}

export function formatWebhooksList(webhooks: Webhook[]): {
  rows: Record<string, unknown>[];
  columns: string[];
} {
  const rows = webhooks.map((w) => ({
    id: w.id,
    url: redactUrlSecrets(w.url),
    enabled: w.enabled,
    resources: w.resourceTypes.join(","),
    team: w.team?.name ?? "(all public)",
  }));
  return { rows, columns: ["id", "url", "enabled", "resources", "team"] };
}

export interface WebhookCreateOptions {
  url: string;
  team?: string;
  allPublicTeams?: boolean;
  resources: string[];
  label?: string;
  apply?: boolean;
  debug?: boolean;
}

export interface WebhookCreateData {
  applied: boolean;
  input: Record<string, unknown>;
  webhook?: Webhook;
}

/**
 * Create a webhook. Dry-run by default (prints intended input); `--apply`
 * executes the mutation. Enforces HTTPS, rejects localhost, and requires a
 * scope (`--team` or `--all-public-teams`).
 */
export async function createWebhook(options: WebhookCreateOptions): Promise<WebhookCreateData> {
  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new ConfigError(`Invalid webhook URL: ${options.url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new ConfigError("Webhook URL must use HTTPS.");
  }
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new ConfigError("Refusing to register a localhost URL as a persistent webhook.");
  }
  if (options.resources.length === 0) {
    throw new ConfigError("At least one --resource is required.");
  }
  if (!options.team && !options.allPublicTeams) {
    throw new ConfigError("Provide either --team <id> or --all-public-teams.");
  }
  if (options.team && options.allPublicTeams) {
    throw new ConfigError("Use either --team or --all-public-teams, not both.");
  }

  const input: Record<string, unknown> = {
    url: options.url,
    resourceTypes: options.resources,
  };
  if (options.label) input.label = options.label;
  if (options.team) input.teamId = options.team;
  if (options.allPublicTeams) input.allPublicTeams = true;

  if (!options.apply) {
    return { applied: false, input: redactWebhookInput(input) };
  }

  const credential = await resolveCredential();
  const result = await executeGraphql<WebhookCreateResult>(
    WEBHOOK_CREATE,
    { input },
    { credential, debug: options.debug },
  );
  if (!result.webhookCreate.success) {
    throw new ConfigError("Linear reported the webhook was not created.");
  }
  return {
    applied: true,
    input: redactWebhookInput(input),
    webhook: redactWebhook(result.webhookCreate.webhook),
  };
}

export interface WebhookDeleteData {
  applied: boolean;
  webhook: Webhook;
}

/**
 * Delete a webhook. Always fetches and prints the target first; `--apply` is
 * required to perform the deletion.
 */
export async function deleteWebhook(
  id: string,
  opts: { apply?: boolean; debug?: boolean },
): Promise<WebhookDeleteData> {
  if (!id.trim()) {
    throw new ConfigError("A webhook ID is required.");
  }
  const credential = await resolveCredential();
  const found = await executeGraphql<WebhookResult>(
    WEBHOOK_QUERY,
    { id },
    { credential, debug: opts.debug },
  );
  if (!found.webhook) {
    throw new ConfigError(`No webhook found with ID: ${id}`);
  }

  if (!opts.apply) {
    return { applied: false, webhook: redactWebhook(found.webhook) };
  }

  const result = await executeGraphql<WebhookDeleteResult>(
    WEBHOOK_DELETE,
    { id },
    { credential, debug: opts.debug },
  );
  if (!result.webhookDelete.success) {
    throw new ConfigError("Linear reported the webhook was not deleted.");
  }
  return { applied: true, webhook: redactWebhook(found.webhook) };
}
