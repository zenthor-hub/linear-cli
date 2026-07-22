import { describe, expect, test } from "vitest";

import {
  archiveNotification,
  createNotificationSubscription,
  DEFAULT_NOTIFICATION_LIST_LIMIT,
  deleteNotificationSubscription,
  formatNotification,
  getNotification,
  getNotificationPreferences,
  getUnreadCount,
  listNotifications,
  markNotificationsRead,
  NOTIFICATION_COMMENT_PREVIEW_CHARS,
  setCategoryChannelSubscription,
  updateNotification,
} from "../src/commands/notifications.ts";
import { ConfigError } from "../src/errors.ts";
import {
  issueLookupResponse,
  issueNode,
  projectsResponse,
  teamsResponse,
  withMockGraphql,
} from "./fixtures.ts";

function notificationNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    type: "issueAssignedToYou",
    category: "assignments",
    title: "Assigned to you",
    subtitle: "STU-123",
    url: "https://linear.app/mirelo/issue/STU-123",
    inboxUrl: "https://linear.app/mirelo/inbox",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    readAt: null,
    snoozedUntilAt: null,
    actor: { id: "u1", name: "Ada" },
    issue: { id: "i1", identifier: "STU-123", title: "Old title" },
    ...overrides,
  };
}

function notificationsResponse(nodes = [notificationNode()], hasNextPage = false) {
  return {
    notifications: {
      nodes,
      pageInfo: { hasNextPage, endCursor: hasNextPage ? "cursor-1" : null },
    },
  };
}

function subscriptionNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "ns1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    active: true,
    notificationSubscriptionTypes: ["issue"],
    contextViewType: null,
    userContextViewType: null,
    subscriber: { id: "u1", name: "Ada", email: "ada@example.com" },
    team: { id: "t1", key: "STU", name: "Studio" },
    project: null,
    cycle: null,
    label: null,
    initiative: null,
    customer: null,
    customView: null,
    user: null,
    ...overrides,
  };
}

function channelFlags(overrides: Partial<Record<string, boolean>> = {}) {
  return {
    desktop: true,
    mobile: true,
    email: true,
    slack: false,
    ...overrides,
  };
}

describe("offline notification workflow execution", () => {
  test("listNotifications returns inbox rows and supports unread client filter", async () => {
    await withMockGraphql(
      [
        notificationsResponse([
          notificationNode({ id: "n1", readAt: null }),
          notificationNode({ id: "n2", readAt: "2026-07-02T00:00:00.000Z", title: "Read one" }),
        ]),
      ],
      async () => {
        const unread = await listNotifications({ unread: true, limit: 10 });
        expect(unread).toHaveLength(1);
        expect(unread[0]?.id).toBe("n1");
      },
    );
  });

  test("listNotifications pages until unread limit is filled", async () => {
    await withMockGraphql(
      [
        notificationsResponse(
          [
            notificationNode({ id: "r1", readAt: "2026-07-02T00:00:00.000Z" }),
            notificationNode({ id: "r2", readAt: "2026-07-02T00:00:00.000Z" }),
          ],
          true,
        ),
        notificationsResponse([
          notificationNode({ id: "u1", readAt: null, title: "Unread A" }),
          notificationNode({ id: "u2", readAt: null, title: "Unread B" }),
        ]),
      ],
      async (requests) => {
        const unread = await listNotifications({ unread: true, limit: 2 });
        expect(unread.map((n) => n.id)).toEqual(["u1", "u2"]);
        expect(requests).toHaveLength(2);
      },
    );
  });

  test("listNotifications applies server type/since filters and client category", async () => {
    await withMockGraphql(
      [
        notificationsResponse([
          notificationNode({ id: "n1", category: "reviews", type: "pullRequestCommented" }),
          notificationNode({ id: "n2", category: "mentions", type: "issueMention" }),
        ]),
      ],
      async (requests) => {
        const rows = await listNotifications({
          type: ["pullRequestCommented", "issueMention"],
          since: "2026-07-01T00:00:00.000Z",
          category: "reviews",
          limit: 10,
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.id).toBe("n1");
        expect(requests[0]?.variables.filter).toEqual({
          type: { in: ["pullRequestCommented", "issueMention"] },
          createdAt: { gte: "2026-07-01T00:00:00.000Z" },
        });
      },
    );
  });

  test("listNotifications defaults limit to 50", async () => {
    const nodes = Array.from({ length: 60 }, (_, index) =>
      notificationNode({ id: `n${index}`, title: `Item ${index}` }),
    );
    await withMockGraphql([notificationsResponse(nodes)], async (requests) => {
      const rows = await listNotifications();
      expect(rows).toHaveLength(DEFAULT_NOTIFICATION_LIST_LIMIT);
      expect(requests).toHaveLength(1);
    });
  });

  test("listNotifications applies subscription-type and before filters", async () => {
    await withMockGraphql([notificationsResponse()], async (requests) => {
      await listNotifications({
        subscriptionType: ["issue", "pullRequest"],
        before: "2026-07-22T00:00:00.000Z",
        limit: 5,
      });
      expect(requests[0]?.variables.filter).toEqual({
        subscriptionType: { in: ["issue", "pullRequest"] },
        createdAt: { lte: "2026-07-22T00:00:00.000Z" },
      });
    });
  });

  test("listNotifications rejects invalid subscription-type", async () => {
    await expect(
      listNotifications({ subscriptionType: "not-real", limit: 5 }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  test("listNotifications rejects inverted since/before", async () => {
    await expect(
      listNotifications({
        since: "2026-07-22T00:00:00.000Z",
        before: "2026-07-01T00:00:00.000Z",
        limit: 5,
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  test("listNotifications rejects invalid category", async () => {
    await expect(
      listNotifications({ category: "not-a-category", limit: 5 }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  test("listNotifications returns partial unread page when inbox exhausted", async () => {
    await withMockGraphql(
      [
        notificationsResponse([
          notificationNode({ id: "r1", readAt: "2026-07-02T00:00:00.000Z" }),
          notificationNode({ id: "u1", readAt: null, title: "Only unread" }),
        ]),
      ],
      async () => {
        const unread = await listNotifications({ unread: true, limit: 5 });
        expect(unread.map((n) => n.id)).toEqual(["u1"]);
      },
    );
  });

  test("formatNotification truncates long comment bodies", () => {
    const longBody = "x".repeat(NOTIFICATION_COMMENT_PREVIEW_CHARS + 50);
    const formatted = formatNotification(
      notificationNode({
        comment: { id: "c1", body: longBody },
      }),
    );
    const commentLine = formatted.split("\n").find((line) => line.startsWith("comment: "));
    expect(commentLine).toBeDefined();
    expect(commentLine?.length).toBe(`comment: `.length + NOTIFICATION_COMMENT_PREVIEW_CHARS);
    expect(commentLine?.endsWith("…")).toBe(true);
  });

  test("getNotification and unread-count query Linear", async () => {
    await withMockGraphql(
      [{ notification: notificationNode() }, { notificationsUnreadCount: 3 }],
      async (requests) => {
        const notification = await getNotification("n1");
        expect(notification.id).toBe("n1");
        expect(await getUnreadCount()).toBe(3);
        expect(requests).toHaveLength(2);
      },
    );
  });

  test("updateNotification dry-run validates id then plans input", async () => {
    await withMockGraphql([{ notification: notificationNode() }], async (requests) => {
      const result = await updateNotification("n1", {
        readAt: "2026-07-22T12:00:00.000Z",
        snoozeUntil: "2026-07-23T12:00:00.000Z",
      });
      expect(result.applied).toBe(false);
      expect(result.input).toEqual({
        readAt: "2026-07-22T12:00:00.000Z",
        snoozedUntilAt: "2026-07-23T12:00:00.000Z",
      });
      expect(requests).toHaveLength(1);
    });
  });

  test("updateNotification --read plans readAt now", async () => {
    await withMockGraphql([{ notification: notificationNode() }], async () => {
      const result = await updateNotification("n1", { read: true });
      expect(result.applied).toBe(false);
      expect(typeof result.input.readAt).toBe("string");
    });
  });

  test("updateNotification --read --apply executes mutation", async () => {
    await withMockGraphql(
      [
        {
          notificationUpdate: {
            success: true,
            notification: notificationNode({ readAt: "2026-07-22T12:00:00.000Z" }),
          },
        },
      ],
      async (requests) => {
        const result = await updateNotification("n1", { read: true, apply: true });
        expect(result.applied).toBe(true);
        expect(result.notification?.readAt).toBe("2026-07-22T12:00:00.000Z");
        const input = requests[0]?.variables.input as { readAt?: string } | undefined;
        expect(typeof input?.readAt).toBe("string");
      },
    );
  });

  test("updateNotification rejects conflicting read flags", async () => {
    await expect(updateNotification("n1", { read: true, unread: true })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  test("updateNotification apply executes mutation", async () => {
    await withMockGraphql(
      [
        {
          notificationUpdate: {
            success: true,
            notification: notificationNode({ readAt: "2026-07-22T12:00:00.000Z" }),
          },
        },
      ],
      async (requests) => {
        const result = await updateNotification("n1", {
          readAt: "2026-07-22T12:00:00.000Z",
          apply: true,
        });
        expect(result.applied).toBe(true);
        expect(result.notification?.readAt).toBe("2026-07-22T12:00:00.000Z");
        expect(requests[0]?.variables).toMatchObject({
          id: "n1",
          input: { readAt: "2026-07-22T12:00:00.000Z" },
        });
      },
    );
  });

  test("markNotificationsRead dry-run resolves issue entity input", async () => {
    await withMockGraphql([issueLookupResponse(issueNode())], async (requests) => {
      const result = await markNotificationsRead({ issue: "STU-123" });
      expect(result.applied).toBe(false);
      expect(result.input).toMatchObject({
        input: { issueId: "i1" },
      });
      expect(typeof (result.input as { readAt?: string }).readAt).toBe("string");
      expect(requests).toHaveLength(1);
    });
  });

  test("markNotificationsRead apply executes batch mutation", async () => {
    await withMockGraphql(
      [
        issueLookupResponse(issueNode()),
        {
          notificationMarkReadAll: {
            success: true,
            notifications: [notificationNode({ readAt: "2026-07-22T12:00:00.000Z" })],
          },
        },
      ],
      async () => {
        const result = await markNotificationsRead({
          issue: "STU-123",
          readAt: "2026-07-22T12:00:00.000Z",
          apply: true,
        });
        expect(result.applied).toBe(true);
        expect(result.notifications).toHaveLength(1);
      },
    );
  });

  test("archiveNotification dry-run fetches target first", async () => {
    await withMockGraphql([{ notification: notificationNode() }], async () => {
      const result = await archiveNotification("n1", {});
      expect(result.applied).toBe(false);
      expect(result.id).toBe("n1");
    });
  });

  test("createNotificationSubscription dry-run resolves team target", async () => {
    await withMockGraphql([teamsResponse()], async () => {
      const result = await createNotificationSubscription({
        team: "STU",
        type: ["issue"],
      });
      expect(result.applied).toBe(false);
      expect(result.input).toEqual({
        teamId: "t1",
        notificationSubscriptionTypes: ["issue"],
      });
    });
  });

  test("createNotificationSubscription rejects invalid type enum", async () => {
    await expect(
      createNotificationSubscription({ team: "STU", type: ["not-a-type"] }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  test("createNotificationSubscription apply creates subscription", async () => {
    await withMockGraphql(
      [
        teamsResponse(),
        {
          notificationSubscriptionCreate: {
            success: true,
            notificationSubscription: subscriptionNode(),
          },
        },
      ],
      async () => {
        const result = await createNotificationSubscription({
          team: "STU",
          apply: true,
        });
        expect(result.applied).toBe(true);
        expect(result.subscription?.id).toBe("ns1");
      },
    );
  });

  test("createNotificationSubscription rejects multiple targets", async () => {
    await expect(
      createNotificationSubscription({ team: "STU", project: "Transcriptor" }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  test("deleteNotificationSubscription dry-run validates id", async () => {
    await withMockGraphql([{ notificationSubscription: subscriptionNode() }], async (requests) => {
      const result = await deleteNotificationSubscription("ns1");
      expect(result.applied).toBe(false);
      expect(result.id).toBe("ns1");
      expect(requests).toHaveLength(1);
    });
  });

  test("deleteNotificationSubscription apply deletes", async () => {
    await withMockGraphql([{ notificationSubscriptionDelete: { success: true } }], async () => {
      const result = await deleteNotificationSubscription("ns1", { apply: true });
      expect(result).toEqual({ applied: true, id: "ns1" });
    });
  });

  test("getNotificationPreferences returns category channel matrix", async () => {
    const categoryPreferences = Object.fromEntries(
      [
        "assignments",
        "statusChanges",
        "commentsAndReplies",
        "mentions",
        "reactions",
        "subscriptions",
        "documentChanges",
        "postsAndUpdates",
        "reminders",
        "reviews",
        "appsAndIntegrations",
        "triage",
        "customers",
        "feed",
        "billing",
        "system",
      ].map((category) => [category, channelFlags(category === "mentions" ? { slack: true } : {})]),
    );
    await withMockGraphql(
      [
        {
          userSettings: {
            id: "settings-1",
            notificationChannelPreferences: channelFlags(),
            notificationCategoryPreferences: categoryPreferences,
          },
        },
      ],
      async () => {
        const prefs = await getNotificationPreferences();
        expect(prefs.channelPreferences.desktop).toBe(true);
        expect(prefs.categoryPreferences).toHaveLength(16);
        expect(prefs.categoryPreferences.find((row) => row.category === "mentions")?.slack).toBe(
          true,
        );
      },
    );
  });

  test("setCategoryChannelSubscription validates enums and dry-runs", async () => {
    await expect(
      setCategoryChannelSubscription({
        channel: "pager",
        category: "assignments",
        subscribe: true,
      }),
    ).rejects.toBeInstanceOf(ConfigError);

    const dry = await setCategoryChannelSubscription({
      channel: "desktop",
      category: "mentions",
      subscribe: true,
    });
    expect(dry.applied).toBe(false);
    expect(dry).toMatchObject({ channel: "desktop", category: "mentions", subscribe: true });
  });

  test("setCategoryChannelSubscription apply executes mutation", async () => {
    await withMockGraphql(
      [{ notificationCategoryChannelSubscriptionUpdate: { success: true } }],
      async (requests) => {
        const result = await setCategoryChannelSubscription({
          channel: "email",
          category: "reviews",
          unsubscribe: true,
          apply: true,
        });
        expect(result.applied).toBe(true);
        expect(result.subscribe).toBe(false);
        expect(requests[0]?.variables).toEqual({
          channel: "email",
          category: "reviews",
          subscribe: false,
        });
      },
    );
  });

  test("project entity resolution uses project lookup", async () => {
    await withMockGraphql([projectsResponse()], async () => {
      const result = await markNotificationsRead({ project: "Transcriptor" });
      expect(result.applied).toBe(false);
      expect(result.input).toMatchObject({
        input: { projectId: "p1" },
      });
    });
  });
});
