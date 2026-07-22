import { ConfigError } from "../../errors.ts";
import { executeGraphql } from "../../graphql/client.ts";
import {
  NOTIFICATION_CATEGORY_CHANNEL_UPDATE,
  buildUserNotificationPreferencesQuery,
  type NotificationChannelPreferenceFlags,
  type NotificationCategoryChannelUpdateResult,
  type UserNotificationPreferencesResult,
} from "../../graphql/documents.ts";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from "./constants.ts";
import type { NotificationPreferences } from "./format.ts";
import { credentialOptions, parseEnumValue } from "./helpers.ts";

export interface CategoryChannelOptions {
  channel: string;
  category: string;
  subscribe?: boolean;
  unsubscribe?: boolean;
  apply?: boolean;
  debug?: boolean;
}

const USER_NOTIFICATION_PREFERENCES_QUERY = buildUserNotificationPreferencesQuery(
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
);

function channelFlags(
  flags: NotificationChannelPreferenceFlags | undefined,
): NotificationChannelPreferenceFlags {
  const result = {} as NotificationChannelPreferenceFlags;
  for (const channel of NOTIFICATION_CHANNELS) {
    result[channel] = flags?.[channel] ?? false;
  }
  return result;
}

export async function getNotificationPreferences(
  options: { debug?: boolean } = {},
): Promise<NotificationPreferences> {
  const data = await executeGraphql<UserNotificationPreferencesResult>(
    USER_NOTIFICATION_PREFERENCES_QUERY,
    {},
    await credentialOptions(options.debug),
  );
  const categoryPreferences = NOTIFICATION_CATEGORIES.map((category) => ({
    category,
    ...channelFlags(data.userSettings.notificationCategoryPreferences[category]),
  }));
  return {
    channelPreferences: data.userSettings.notificationChannelPreferences,
    categoryPreferences,
  };
}

export async function setCategoryChannelSubscription(options: CategoryChannelOptions): Promise<{
  applied: boolean;
  channel: NotificationChannel;
  category: NotificationCategory;
  subscribe: boolean;
}> {
  const channel = parseEnumValue(options.channel.toLowerCase(), NOTIFICATION_CHANNELS, "--channel");
  const category = parseEnumValue(options.category, NOTIFICATION_CATEGORIES, "--category");
  if (options.subscribe && options.unsubscribe) {
    throw new ConfigError("Use either --subscribe or --unsubscribe, not both.");
  }
  if (!options.subscribe && !options.unsubscribe) {
    throw new ConfigError("Provide --subscribe or --unsubscribe.");
  }
  const subscribe = Boolean(options.subscribe);

  if (!options.apply) {
    return { applied: false, channel, category, subscribe };
  }

  const result = await executeGraphql<NotificationCategoryChannelUpdateResult>(
    NOTIFICATION_CATEGORY_CHANNEL_UPDATE,
    { channel, category, subscribe },
    await credentialOptions(options.debug),
  );
  if (!result.notificationCategoryChannelSubscriptionUpdate.success) {
    throw new ConfigError("Linear reported the category/channel preference was not updated.");
  }
  return { applied: true, channel, category, subscribe };
}
