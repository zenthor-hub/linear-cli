import { describe, expect, test } from "vitest";

import {
  archiveIssue,
  commentOnIssue,
  createIssue,
  createIssueRelation,
  getIssue,
  listIssueComments,
  listIssueRelations,
  parsePositiveLimit,
  searchIssues,
  unarchiveIssue,
  updateIssue,
} from "../src/commands/issues.ts";
import { createLabel } from "../src/commands/labels.ts";
import { ConfigError } from "../src/errors.ts";
import {
  cyclesResponse,
  issueLookupResponse,
  issueNode,
  labelsResponse,
  parentIssue,
  projectsResponse,
  statesResponse,
  teamNode,
  teamsResponse,
  usersResponse,
  withMockGraphql,
} from "./fixtures.ts";

describe("offline issue workflow execution", () => {
  test("getIssue resolves human issue identifiers through structured filters", async () => {
    await withMockGraphql(
      [{ issues: { nodes: [issueNode()], pageInfo: { hasNextPage: false, endCursor: null } } }],
      async (requests) => {
        const issue = await getIssue("STU-123");

        expect(issue.identifier).toBe("STU-123");
        expect(requests[0]?.variables).toEqual({
          teamKey: "STU",
          number: 123,
          includeArchived: false,
        });
      },
    );
  });

  test("updateIssue dry-run resolves state, assignee, priority, and labels", async () => {
    await withMockGraphql(
      [
        { issues: { nodes: [issueNode()], pageInfo: { hasNextPage: false, endCursor: null } } },
        teamsResponse(),
        statesResponse(),
        usersResponse(),
        labelsResponse(),
      ],
      async () => {
        const result = await updateIssue("STU-123", {
          title: "New title",
          state: "Done",
          assignee: "ada@example.com",
          priority: "high",
          label: ["bug"],
        });

        expect(result.applied).toBe(false);
        expect(result.input).toMatchObject({
          title: "New title",
          stateId: "s2",
          assigneeId: "u1",
          priority: 2,
          labelIds: ["l1"],
        });
        expect(result.plannedChanges.state).toEqual({ from: "Todo", to: "Done" });
      },
    );
  });

  test("updateIssue dry-run does not plan omitted fields or no-op state changes", async () => {
    await withMockGraphql(
      [
        { issues: { nodes: [issueNode()], pageInfo: { hasNextPage: false, endCursor: null } } },
        teamsResponse(),
        statesResponse(),
      ],
      async () => {
        const result = await updateIssue("STU-123", { state: "Todo" });

        expect(result.applied).toBe(false);
        expect(result.input).toEqual({});
        expect(result.plannedChanges).toEqual({});
      },
    );
  });

  test("updateIssue dry-run resolves parent metadata without mutating", async () => {
    await withMockGraphql(
      [issueLookupResponse(), issueLookupResponse(issueNode(parentIssue))],
      async () => {
        const result = await updateIssue("STU-123", { parent: "STU-993" });

        expect(result.applied).toBe(false);
        expect(result.input).toEqual({ parentId: "parent-1" });
        expect(result.plannedChanges.parent).toEqual({ from: null, to: "STU-993" });
      },
    );
  });

  test("updateIssue dry-run can clear parent without mutating", async () => {
    await withMockGraphql([issueLookupResponse(issueNode({ parent: parentIssue }))], async () => {
      const result = await updateIssue("STU-123", { parent: "none" });

      expect(result.applied).toBe(false);
      expect(result.input).toEqual({ parentId: null });
      expect(result.plannedChanges.parent).toEqual({ from: "STU-993", to: null });
    });
  });

  test("updateIssue applies parent metadata in mutation input", async () => {
    await withMockGraphql(
      [
        issueLookupResponse(),
        issueLookupResponse(issueNode(parentIssue)),
        {
          issueUpdate: {
            success: true,
            issue: issueNode({ parent: parentIssue }),
          },
        },
      ],
      async (requests) => {
        const result = await updateIssue("STU-123", { parent: "STU-993", apply: true });

        expect(result.applied).toBe(true);
        expect(requests.at(-1)?.variables).toEqual({
          id: "i1",
          input: { parentId: "parent-1" },
        });
      },
    );
  });

  test("createIssue dry-run resolves team metadata without mutating", async () => {
    await withMockGraphql(
      [teamsResponse(), teamsResponse(), statesResponse(), labelsResponse()],
      async () => {
        const result = await createIssue({
          team: "STU",
          title: "New issue",
          description: "Body",
          state: "Todo",
          label: ["bug"],
        });

        expect(result).toEqual({
          applied: false,
          input: {
            teamId: "t1",
            title: "New issue",
            description: "Body",
            stateId: "s1",
            labelIds: ["l1"],
          },
        });
      },
    );
  });

  test("createIssue dry-run resolves project metadata without mutating", async () => {
    await withMockGraphql([teamsResponse(), projectsResponse()], async () => {
      const result = await createIssue({
        team: "STU",
        title: "New issue",
        project: "Transcriptor",
      });

      expect(result).toEqual({
        applied: false,
        input: {
          teamId: "t1",
          title: "New issue",
          projectId: "p1",
        },
      });
    });
  });

  test("createIssue dry-run resolves parent metadata without mutating", async () => {
    await withMockGraphql(
      [teamsResponse(), issueLookupResponse(issueNode(parentIssue))],
      async () => {
        const result = await createIssue({
          team: "STU",
          title: "New issue",
          parent: "STU-993",
        });

        expect(result).toEqual({
          applied: false,
          input: {
            teamId: "t1",
            title: "New issue",
            parentId: "parent-1",
          },
        });
      },
    );
  });

  test("createIssue applies parent metadata in mutation input", async () => {
    await withMockGraphql(
      [
        teamsResponse(),
        issueLookupResponse(issueNode(parentIssue)),
        {
          issueCreate: {
            success: true,
            issue: issueNode({ id: "i2", identifier: "STU-124", parent: parentIssue }),
          },
        },
      ],
      async (requests) => {
        const result = await createIssue({
          team: "STU",
          title: "New issue",
          parent: "STU-993",
          apply: true,
        });

        expect(result.applied).toBe(true);
        expect(requests.at(-1)?.variables.input).toEqual({
          teamId: "t1",
          title: "New issue",
          parentId: "parent-1",
        });
      },
    );
  });

  test("createIssue rejects parent clear references", async () => {
    await withMockGraphql([teamsResponse()], async () => {
      await expect(
        createIssue({
          team: "STU",
          title: "New issue",
          parent: "none",
        }),
      ).rejects.toThrow(ConfigError);
    });
  });

  test("createIssue rejects unknown project references", async () => {
    await withMockGraphql([teamsResponse(), projectsResponse([])], async () => {
      await expect(
        createIssue({
          team: "STU",
          title: "New issue",
          project: "Missing",
        }),
      ).rejects.toThrow(ConfigError);
    });
  });

  test("createIssue rejects ambiguous project references", async () => {
    await withMockGraphql(
      [
        teamsResponse(),
        projectsResponse([
          { id: "p1", name: "Transcriptor", state: "started" },
          { id: "p2", name: "transcriptor", state: "backlog" },
        ]),
      ],
      async () => {
        await expect(
          createIssue({
            team: "STU",
            title: "New issue",
            project: "Transcriptor",
          }),
        ).rejects.toThrow(ConfigError);
      },
    );
  });

  test("commentOnIssue dry-run reads the target issue and planned body", async () => {
    await withMockGraphql(
      [{ issues: { nodes: [issueNode()], pageInfo: { hasNextPage: false, endCursor: null } } }],
      async () => {
        const result = await commentOnIssue("STU-123", { body: "Looks good." });

        expect(result.applied).toBe(false);
        expect(result.input).toEqual({ issueId: "i1", body: "Looks good." });
      },
    );
  });

  test("searchIssues defaults to a bounded limit and supports full-text query", async () => {
    await withMockGraphql(
      [
        {
          searchIssues: {
            nodes: [issueNode(), issueNode({ id: "i2", identifier: "STU-124", number: 124 })],
            pageInfo: { hasNextPage: true, endCursor: "c1" },
          },
        },
      ],
      async (requests) => {
        const issues = await searchIssues({ query: "export flow", limit: 1 });

        expect(issues).toHaveLength(1);
        expect(issues[0]?.identifier).toBe("STU-123");
        expect(requests[0]?.query).toContain("searchIssues");
        expect(requests[0]?.variables.term).toBe("export flow");
      },
    );
  });

  test("updateIssue dry-run supports project, cycle, due date, estimate, and additive labels", async () => {
    await withMockGraphql(
      [issueLookupResponse(), labelsResponse(), projectsResponse(), cyclesResponse()],
      async () => {
        const result = await updateIssue("STU-123", {
          project: "Transcriptor",
          cycle: "1",
          dueDate: "2026-03-01",
          estimate: "3",
          addLabel: ["bug"],
        });

        expect(result.applied).toBe(false);
        expect(result.input).toMatchObject({
          projectId: "p1",
          cycleId: "c1",
          dueDate: "2026-03-01",
          estimate: 3,
          addedLabelIds: ["l1"],
        });
      },
    );
  });

  test("updateIssue rejects combining replace and additive labels", async () => {
    await withMockGraphql([issueLookupResponse()], async () => {
      await expect(updateIssue("STU-123", { label: ["bug"], addLabel: ["bug"] })).rejects.toThrow(
        ConfigError,
      );
    });
  });

  test("archiveIssue dry-run does not mutate", async () => {
    await withMockGraphql([issueLookupResponse()], async () => {
      const result = await archiveIssue("STU-123", { trash: true });
      expect(result).toEqual({
        applied: false,
        issue: expect.objectContaining({ id: "i1" }),
        trash: true,
      });
    });
  });

  test("createLabel dry-run builds workspace input, filters workspace-only, rejects bad color", async () => {
    await withMockGraphql(
      [
        {
          issueLabels: {
            nodes: [
              {
                id: "l-existing",
                name: "Source: Meeting 2026-07-21",
                color: "#0ea5e9",
                team: null,
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      async (requests) => {
        const result = await createLabel({
          name: "Source: Meeting 2026-08-04",
          color: "#0ea5e9",
          description: "Tickets from Catapult - 04082026",
        });
        expect(result.applied).toBe(false);
        expect(result.input).toEqual({
          name: "Source: Meeting 2026-08-04",
          color: "#0ea5e9",
          description: "Tickets from Catapult - 04082026",
        });
        expect(requests[0]?.variables.filter).toEqual({ team: { null: true } });
      },
    );

    await expect(createLabel({ name: "x", color: "red" })).rejects.toThrow(ConfigError);
    await expect(createLabel({ name: "   " })).rejects.toThrow(/Label name is required/);
  });

  test("createLabel rejects duplicate workspace name", async () => {
    await withMockGraphql(
      [
        {
          issueLabels: {
            nodes: [
              {
                id: "l1",
                name: "Source: Meeting 2026-08-04",
                color: "#0ea5e9",
                team: null,
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      async () => {
        await expect(createLabel({ name: "Source: Meeting 2026-08-04" })).rejects.toThrow(
          /Label already exists/,
        );
      },
    );
  });

  test("createLabel allows same name on team when only a workspace label exists", async () => {
    await withMockGraphql(
      [
        teamsResponse(),
        {
          issueLabels: {
            nodes: [
              {
                id: "l-ws",
                name: "Shared",
                color: "#0ea5e9",
                team: null,
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      async (requests) => {
        const result = await createLabel({
          name: "Shared",
          team: "STU",
          color: "#111111",
        });
        expect(result.applied).toBe(false);
        expect(result.input).toEqual({
          name: "Shared",
          color: "#111111",
          teamId: teamNode.id,
        });
        expect(requests[1]?.variables.filter).toEqual({
          or: [{ team: { key: { eq: "STU" } } }, { team: { null: true } }],
        });
      },
    );
  });

  test("createLabel team-scoped create sets teamId and rejects replace-team-labels", async () => {
    await withMockGraphql(
      [
        teamsResponse(),
        {
          issueLabels: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      async () => {
        const result = await createLabel({ name: "team-only", team: "STU" });
        expect(result.input.teamId).toBe(teamNode.id);
      },
    );

    await expect(createLabel({ name: "x", team: "STU", replaceTeamLabels: true })).rejects.toThrow(
      /only applies when creating a workspace label/,
    );
  });

  test("createLabel parent resolution ignores team labels for workspace create", async () => {
    await withMockGraphql(
      [
        {
          issueLabels: {
            nodes: [
              // workspace-only fetch should not return team labels; empty = no parent
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      async (requests) => {
        await expect(createLabel({ name: "child", parent: "Group" })).rejects.toThrow(
          /No parent label found/,
        );
        expect(requests[0]?.variables.filter).toEqual({ team: { null: true } });
      },
    );
  });

  test("createLabel parent picks workspace parent and not same-named team label", async () => {
    await withMockGraphql(
      [
        {
          issueLabels: {
            nodes: [
              {
                id: "parent-ws",
                name: "Group",
                color: "#000",
                team: null,
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      async () => {
        const result = await createLabel({ name: "child", parent: "Group" });
        expect(result.input.parentId).toBe("parent-ws");
      },
    );
  });

  test("createLabel team create can parent to workspace or team label", async () => {
    await withMockGraphql(
      [
        teamsResponse(),
        {
          issueLabels: {
            nodes: [
              {
                id: "parent-ws",
                name: "Group",
                color: "#000",
                team: null,
              },
              {
                id: "parent-team",
                name: "TeamGroup",
                color: "#111",
                team: { id: teamNode.id, key: teamNode.key, name: teamNode.name },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      async () => {
        const viaWorkspace = await createLabel({
          name: "child-a",
          team: "STU",
          parent: "Group",
        });
        expect(viaWorkspace.input.parentId).toBe("parent-ws");
      },
    );

    await withMockGraphql(
      [
        teamsResponse(),
        {
          issueLabels: {
            nodes: [
              {
                id: "parent-team",
                name: "TeamGroup",
                color: "#111",
                team: { id: teamNode.id, key: teamNode.key, name: teamNode.name },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      async () => {
        const viaTeam = await createLabel({
          name: "child-b",
          team: "STU",
          parent: "TeamGroup",
        });
        expect(viaTeam.input.parentId).toBe("parent-team");
      },
    );
  });

  test("createLabel rejects empty parent and ambiguous parent names", async () => {
    await expect(createLabel({ name: "x", parent: "   " })).rejects.toThrow(
      /Parent label reference is required/,
    );

    await withMockGraphql(
      [
        {
          issueLabels: {
            nodes: [
              { id: "p1", name: "Group", color: "#000", team: null },
              { id: "p2", name: "Group", color: "#111", team: null },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      async () => {
        await expect(createLabel({ name: "child", parent: "Group" })).rejects.toThrow(
          /Parent label reference is ambiguous/,
        );
      },
    );
  });

  test("createLabel replaceTeamLabels is top-level variable, not inside input", async () => {
    await withMockGraphql(
      [
        {
          issueLabels: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      async () => {
        const dry = await createLabel({
          name: "Promo",
          color: "#0ea5e9",
          replaceTeamLabels: true,
        });
        expect(dry.replaceTeamLabels).toBe(true);
        expect(dry.input).not.toHaveProperty("replaceTeamLabels");
      },
    );

    await withMockGraphql(
      [
        {
          issueLabels: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
        {
          issueLabelCreate: {
            success: true,
            issueLabel: {
              id: "l-new",
              name: "Promo",
              color: "#0ea5e9",
              description: null,
              team: null,
            },
          },
        },
      ],
      async (requests) => {
        const result = await createLabel({
          name: "Promo",
          color: "#0ea5e9",
          replaceTeamLabels: true,
          apply: true,
        });
        expect(result.applied).toBe(true);
        expect(requests[1]?.query).toContain("issueLabelCreate");
        expect(requests[1]?.variables.input).toEqual({
          name: "Promo",
          color: "#0ea5e9",
        });
        expect(requests[1]?.variables.replaceTeamLabels).toBe(true);
      },
    );
  });

  test("createLabel --apply executes issueLabelCreate", async () => {
    await withMockGraphql(
      [
        {
          issueLabels: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
        {
          issueLabelCreate: {
            success: true,
            issueLabel: {
              id: "l-new",
              name: "Source: Meeting 2026-08-04",
              color: "#0ea5e9",
              description: null,
              team: null,
            },
          },
        },
      ],
      async (requests) => {
        const result = await createLabel({
          name: "Source: Meeting 2026-08-04",
          color: "#0ea5e9",
          apply: true,
        });
        expect(result.applied).toBe(true);
        expect(result.result?.id).toBe("l-new");
        expect(requests[1]?.query).toContain("issueLabelCreate");
        expect(requests[1]?.variables.input).toEqual({
          name: "Source: Meeting 2026-08-04",
          color: "#0ea5e9",
        });
      },
    );
  });

  test("listIssueComments returns comment nodes", async () => {
    await withMockGraphql(
      [
        issueLookupResponse(),
        {
          issue: {
            id: "i1",
            identifier: "STU-123",
            comments: {
              nodes: [
                {
                  id: "cm1",
                  body: "Hello",
                  url: "https://linear.app/c/1",
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                  user: { id: "u1", name: "Ada", email: "ada@example.com" },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      ],
      async () => {
        const result = await listIssueComments("STU-123");
        expect(result.comments).toHaveLength(1);
        expect(result.comments[0]?.body).toBe("Hello");
      },
    );
  });

  test("createIssueRelation dry-run resolves both issues", async () => {
    await withMockGraphql(
      [
        issueLookupResponse(),
        issueLookupResponse(issueNode({ id: "i2", identifier: "STU-124", number: 124 })),
      ],
      async () => {
        const result = await createIssueRelation("STU-123", {
          type: "blocks",
          related: "STU-124",
        });
        expect(result.applied).toBe(false);
        expect(result.input).toEqual({
          issueId: "i1",
          relatedIssueId: "i2",
          type: "blocks",
        });
      },
    );
  });

  test("unarchiveIssue identifier lookup includes archived issues", async () => {
    await withMockGraphql([issueLookupResponse()], async (requests) => {
      const result = await unarchiveIssue("STU-123");
      expect(result.applied).toBe(false);
      expect(requests[0]?.variables).toMatchObject({
        teamKey: "STU",
        number: 123,
        includeArchived: true,
      });
    });
  });

  test("getIssue identifier lookup defaults to excluding archived", async () => {
    await withMockGraphql([issueLookupResponse()], async (requests) => {
      await getIssue("STU-123");
      expect(requests[0]?.variables).toMatchObject({ includeArchived: false });
    });
  });

  test("updateIssue rejects fractional estimates", async () => {
    await withMockGraphql([issueLookupResponse()], async () => {
      await expect(updateIssue("STU-123", { estimate: "1.5" })).rejects.toThrow(ConfigError);
    });
  });

  test("parsePositiveLimit rejects invalid values", () => {
    expect(() => parsePositiveLimit(Number("nope"))).toThrow(ConfigError);
    expect(() => parsePositiveLimit(0)).toThrow(ConfigError);
    expect(() => parsePositiveLimit(-1)).toThrow(ConfigError);
    expect(parsePositiveLimit(undefined, 50)).toBe(50);
    expect(parsePositiveLimit(10)).toBe(10);
  });

  test("listIssueRelations paginates outgoing and incoming connections", async () => {
    await withMockGraphql(
      [
        issueLookupResponse(),
        {
          issue: {
            id: "i1",
            identifier: "STU-123",
            relations: {
              nodes: [
                {
                  id: "r1",
                  type: "blocks",
                  issue: { id: "i1", identifier: "STU-123", title: "Old title" },
                  relatedIssue: { id: "i2", identifier: "STU-124", title: "Other" },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
        {
          issue: {
            id: "i1",
            identifier: "STU-123",
            inverseRelations: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      ],
      async (requests) => {
        const result = await listIssueRelations("STU-123");
        expect(result.relations).toHaveLength(1);
        expect(result.inverseRelations).toHaveLength(0);
        expect(requests[1]?.query).toContain("relations");
        expect(requests[2]?.query).toContain("inverseRelations");
      },
    );
  });
});
