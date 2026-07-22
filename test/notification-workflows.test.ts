import { describe, expect, test } from "vitest";

import {
  archiveNotification,
  createNotificationSubscription,
  getNotification,
  getUnreadCount,
  listNotifications,
  markNotificationsRead,
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

function notificationsResponse(nodes = [notificationNode()]) {
  return {
    notifications: { nodes, pageInfo: { hasNextPage: false, endCursor: null } },
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

  test("updateNotification dry-run plans input without mutating", async () => {
    await withMockGraphql([], async (requests) => {
      const result = await updateNotification("n1", {
        readAt: "2026-07-22T12:00:00.000Z",
        snoozeUntil: "2026-07-23T12:00:00.000Z",
      });
      expect(result.applied).toBe(false);
      expect(result.input).toEqual({
        readAt: "2026-07-22T12:00:00.000Z",
        snoozedUntilAt: "2026-07-23T12:00:00.000Z",
      });
      expect(requests).toHaveLength(0);
    });
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
