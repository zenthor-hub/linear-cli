import { describe, expect, test } from "vitest";

import { commentOnIssue, createIssue, getIssue, updateIssue } from "../src/commands/issues.ts";
import { ConfigError } from "../src/errors.ts";
import {
  issueLookupResponse,
  issueNode,
  labelsResponse,
  parentIssue,
  projectsResponse,
  statesResponse,
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
        expect(requests[0]?.variables).toEqual({ teamKey: "STU", number: 123 });
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
        teamsResponse(),
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
      [teamsResponse(), teamsResponse(), statesResponse(), teamsResponse(), labelsResponse()],
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
});
