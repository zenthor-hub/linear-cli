import { ConfigError } from "../../errors.ts";
import { executeGraphql } from "../../graphql/client.ts";
import {
  NOTIFICATION_SUBSCRIPTION_CREATE,
  NOTIFICATION_SUBSCRIPTION_DELETE,
  NOTIFICATION_SUBSCRIPTION_QUERY,
  NOTIFICATION_SUBSCRIPTION_UPDATE,
  NOTIFICATION_SUBSCRIPTIONS_QUERY,
  type NotificationSubscription,
  type NotificationSubscriptionCreateResult,
  type NotificationSubscriptionDeleteResult,
  type NotificationSubscriptionResult,
  type NotificationSubscriptionsResult,
  type NotificationSubscriptionUpdateResult,
} from "../../graphql/documents.ts";
import { fetchNodes } from "../../graphql/paginate.ts";
import { listLabels, parsePositiveLimit, resolveTeam } from "../issues.ts";
import { getProject } from "../projects.ts";
import { singleMatch } from "../shared.ts";
import { resolveUser } from "../users.ts";
import { credentialOptions, normalizeStringList, requireExactlyOne } from "./helpers.ts";

export interface NotificationSubscriptionCreateOptions {
  team?: string;
  project?: string;
  cycle?: string;
  label?: string;
  initiative?: string;
  customer?: string;
  customView?: string;
  user?: string;
  type?: string[];
  active?: boolean;
  apply?: boolean;
  debug?: boolean;
}

export interface NotificationSubscriptionUpdateOptions {
  type?: string[];
  active?: boolean;
  apply?: boolean;
  debug?: boolean;
}

export async function listNotificationSubscriptions(
  options: { limit?: number; includeArchived?: boolean; debug?: boolean } = {},
): Promise<NotificationSubscription[]> {
  const limit = parsePositiveLimit(options.limit);
  return fetchNodes<NotificationSubscription, NotificationSubscriptionsResult>(
    NOTIFICATION_SUBSCRIPTIONS_QUERY,
    (data) => data.notificationSubscriptions,
    await credentialOptions(options.debug),
    {
      includeArchived: options.includeArchived ?? false,
      orderBy: "createdAt",
    },
    { limit },
  );
}

export async function getNotificationSubscription(
  id: string,
  options: { debug?: boolean } = {},
): Promise<NotificationSubscription> {
  if (!id.trim()) throw new ConfigError("A notification subscription ID is required.");
  const data = await executeGraphql<NotificationSubscriptionResult>(
    NOTIFICATION_SUBSCRIPTION_QUERY,
    { id },
    await credentialOptions(options.debug),
  );
  if (!data.notificationSubscription) {
    throw new ConfigError(`No notification subscription found with ID: ${id}`);
  }
  return data.notificationSubscription;
}

async function resolveLabelIdForSubscription(labelRef: string, debug?: boolean): Promise<string> {
  if (/^[0-9a-f-]{20,}$/i.test(labelRef)) return labelRef;
  const labels = await listLabels({ includeWorkspace: true, debug });
  const normalized = labelRef.toLowerCase();
  const matches = labels.filter(
    (label) => label.id === labelRef || label.name.toLowerCase() === normalized,
  );
  const label = singleMatch(
    matches,
    `No label found for: ${labelRef}`,
    `Label reference is ambiguous: ${labelRef}. Pass a label ID instead.`,
  );
  return label.id;
}

async function resolveSubscriptionCreateInput(
  options: NotificationSubscriptionCreateOptions,
): Promise<Record<string, unknown>> {
  const { key, value } = requireExactlyOne(
    {
      team: options.team,
      project: options.project,
      cycle: options.cycle,
      label: options.label,
      initiative: options.initiative,
      customer: options.customer,
      customView: options.customView,
      user: options.user,
    },
    "Provide exactly one of --team, --project, --cycle, --label, --initiative, --customer, --custom-view, or --user.",
    "Provide only one subscription target selector.",
  );

  const input: Record<string, unknown> = {};
  const types = normalizeStringList(options.type);
  if (types.length) input.notificationSubscriptionTypes = types;
  if (options.active !== undefined) input.active = options.active;

  switch (key) {
    case "team":
      input.teamId = (await resolveTeam(value, { debug: options.debug })).id;
      return input;
    case "project":
      input.projectId = (await getProject(value, { debug: options.debug })).id;
      return input;
    case "cycle":
      if (!/^[0-9a-f-]{20,}$/i.test(value)) {
        throw new ConfigError(
          "Cycle subscriptions require a cycle ID (use `linear cycle list --team ...` to discover IDs).",
        );
      }
      input.cycleId = value;
      return input;
    case "label":
      input.labelId = await resolveLabelIdForSubscription(value, options.debug);
      return input;
    case "initiative":
      input.initiativeId = value;
      return input;
    case "customer":
      input.customerId = value;
      return input;
    case "customView":
      input.customViewId = value;
      return input;
    case "user":
      input.userId = (await resolveUser(value, { debug: options.debug })).id;
      return input;
  }
}

export async function createNotificationSubscription(
  options: NotificationSubscriptionCreateOptions,
): Promise<{
  applied: boolean;
  input: Record<string, unknown>;
  subscription?: NotificationSubscription;
}> {
  const input = await resolveSubscriptionCreateInput(options);
  if (!options.apply) {
    return { applied: false, input };
  }
  const result = await executeGraphql<NotificationSubscriptionCreateResult>(
    NOTIFICATION_SUBSCRIPTION_CREATE,
    { input },
    await credentialOptions(options.debug),
  );
  if (!result.notificationSubscriptionCreate.success) {
    throw new ConfigError("Linear reported the notification subscription was not created.");
  }
  return {
    applied: true,
    input,
    subscription: result.notificationSubscriptionCreate.notificationSubscription,
  };
}

export async function updateNotificationSubscription(
  id: string,
  options: NotificationSubscriptionUpdateOptions,
): Promise<{
  applied: boolean;
  id: string;
  input: Record<string, unknown>;
  subscription?: NotificationSubscription;
}> {
  if (!id.trim()) throw new ConfigError("A notification subscription ID is required.");
  const input: Record<string, unknown> = {};
  const types = normalizeStringList(options.type);
  if (types.length) input.notificationSubscriptionTypes = types;
  if (options.active !== undefined) input.active = options.active;
  if (Object.keys(input).length === 0) {
    throw new ConfigError("Provide at least one of --type, --active, or --inactive.");
  }

  if (!options.apply) {
    await getNotificationSubscription(id, options);
    return { applied: false, id, input };
  }

  const result = await executeGraphql<NotificationSubscriptionUpdateResult>(
    NOTIFICATION_SUBSCRIPTION_UPDATE,
    { id, input },
    await credentialOptions(options.debug),
  );
  if (!result.notificationSubscriptionUpdate.success) {
    throw new ConfigError("Linear reported the notification subscription was not updated.");
  }
  return {
    applied: true,
    id,
    input,
    subscription: result.notificationSubscriptionUpdate.notificationSubscription,
  };
}

export async function deleteNotificationSubscription(
  id: string,
  options: { apply?: boolean; debug?: boolean } = {},
): Promise<{ applied: boolean; id: string }> {
  if (!id.trim()) throw new ConfigError("A notification subscription ID is required.");
  if (!options.apply) {
    await getNotificationSubscription(id, options);
    return { applied: false, id };
  }
  const result = await executeGraphql<NotificationSubscriptionDeleteResult>(
    NOTIFICATION_SUBSCRIPTION_DELETE,
    { id },
    await credentialOptions(options.debug),
  );
  if (!result.notificationSubscriptionDelete.success) {
    throw new ConfigError("Linear reported the notification subscription was not deleted.");
  }
  return { applied: true, id };
}
