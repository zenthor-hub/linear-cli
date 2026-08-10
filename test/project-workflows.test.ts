import { describe, expect, test } from "vitest";

import { searchIssues } from "../src/commands/issues.ts";
import {
  formatProject,
  getProject,
  listProjectUpdates,
  listProjects,
  parseProjectUpdateHealth,
  postProjectUpdate,
  resolveProjectReference,
  updateProject,
} from "../src/commands/projects.ts";
import { ConfigError } from "../src/errors.ts";
import {
  issueNode,
  projectNode,
  projectUpdateNode,
  projectStatusesResponse,
  projectUpdatesResponse,
  projectsResponse,
  teamsResponse,
  withMockGraphql,
} from "./fixtures.ts";

describe("offline project workflows", () => {
  test("project reads expose health, dates, and recent updates while human output stays concise", async () => {
    await withMockGraphql(
      [
        projectsResponse([
          projectNode({
            health: "atRisk",
            startDate: "2026-02-01",
            targetDate: "2026-05-01",
            projectUpdates: [projectUpdateNode({ health: "atRisk" })],
          }),
        ]),
      ],
      async (requests) => {
        const project = await getProject("Transcriptor");

        expect(project).toMatchObject({
          health: "atRisk",
          startDate: "2026-02-01",
          targetDate: "2026-05-01",
          projectUpdates: [{ health: "atRisk" }],
        });
        expect(formatProject(project)).toContain("Recent updates: 1");
        expect(requests[0]?.query).toContain("projectUpdates");
      },
    );
  });

  test("project lists and reference resolution use lean queries with explicit archive policy", async () => {
    await withMockGraphql([projectsResponse(), projectsResponse()], async (requests) => {
      const projects = await listProjects();
      const project = await resolveProjectReference("Transcriptor", {
        includeArchived: true,
      });

      expect(projects[0]?.id).toBe("p1");
      expect(project.id).toBe("p1");
      expect(requests[0]?.query).not.toContain("projectUpdates");
      expect(requests[0]?.variables.includeArchived).toBe(false);
      expect(requests[1]?.query).not.toContain("projectUpdates");
      expect(requests[1]?.variables.includeArchived).toBe(true);
    });
  });

  test("updateProject dry-run resolves current state and planned changes", async () => {
    await withMockGraphql(
      [
        projectsResponse(),
        projectStatusesResponse([{ id: "ps2", name: "Paused", type: "paused" }]),
      ],
      async (requests) => {
        const result = await updateProject("Transcriptor", {
          description: "New description",
          name: "Transcriptor v2",
          status: "Paused",
          startDate: "2026-02-01",
          targetDate: "2026-04-01",
        });

        expect(result.applied).toBe(false);
        expect(result.project.id).toBe("p1");
        expect(result.input).toEqual({
          name: "Transcriptor v2",
          description: "New description",
          statusId: "ps2",
          startDate: "2026-02-01",
          targetDate: "2026-04-01",
        });
        expect(result.plannedChanges).toMatchObject({
          status: { from: "In Progress", to: "Paused" },
          startDate: { from: "2026-01-01", to: "2026-02-01" },
        });
        expect(requests).toHaveLength(2);
      },
    );
  });

  test("updateProject applies the planned input and returns the resulting project URL", async () => {
    const updated = projectNode({
      name: "Transcriptor v2",
      description: "New description",
      status: { id: "ps2", name: "Paused", type: "paused" },
    });
    await withMockGraphql(
      [
        projectsResponse(),
        projectStatusesResponse([{ id: "ps2", name: "Paused", type: "paused" }]),
        { projectUpdate: { success: true, project: updated } },
      ],
      async (requests) => {
        const result = await updateProject("Transcriptor", {
          name: "Transcriptor v2",
          description: "New description",
          status: "Paused",
          apply: true,
        });

        expect(result.applied).toBe(true);
        expect(result.result?.url).toBe(updated.url);
        expect(requests.at(-1)?.variables).toEqual({
          id: "p1",
          input: {
            name: "Transcriptor v2",
            description: "New description",
            statusId: "ps2",
          },
        });
      },
    );
  });

  test("updateProject treats an unchanged update as a no-op even with --apply", async () => {
    await withMockGraphql([projectsResponse()], async (requests) => {
      const result = await updateProject("Transcriptor", {
        description: "Transcription work",
        apply: true,
      });

      expect(result.applied).toBe(false);
      expect(result.input).toEqual({});
      expect(result.plannedChanges).toEqual({});
      expect(requests).toHaveLength(1);
    });
  });

  test("project validation rejects long descriptions, bad dates, and invalid health", async () => {
    await withMockGraphql([projectsResponse()], async () => {
      await expect(
        updateProject("Transcriptor", { description: "x".repeat(255) }),
      ).resolves.toMatchObject({ applied: false });
    });

    await withMockGraphql([projectsResponse()], async () => {
      await expect(updateProject("Transcriptor", { description: "x".repeat(256) })).rejects.toThrow(
        /255 Unicode characters or fewer/,
      );
    });

    await withMockGraphql([projectsResponse()], async () => {
      await expect(updateProject("Transcriptor", { startDate: "2026-02-31" })).rejects.toThrow(
        /valid YYYY-MM-DD/,
      );
    });

    await withMockGraphql([projectsResponse()], async () => {
      await expect(
        postProjectUpdate("Transcriptor", { body: "Update", health: "blocked" }),
      ).rejects.toThrow(ConfigError);
    });
  });

  test("postProjectUpdate dry-run validates body and includes project health changes", async () => {
    await withMockGraphql([projectsResponse([projectNode({ health: "atRisk" })])], async () => {
      const result = await postProjectUpdate("Transcriptor", {
        body: "We are back on track.",
        health: "onTrack",
      });

      expect(result.applied).toBe(false);
      expect(result.input).toEqual({
        projectId: "p1",
        body: "We are back on track.",
        health: "onTrack",
      });
      expect(result.plannedChanges.health).toEqual({ from: "atRisk", to: "onTrack" });
    });

    await withMockGraphql([projectsResponse()], async () => {
      await expect(
        postProjectUpdate("Transcriptor", { body: "  ", health: "onTrack" }),
      ).rejects.toThrow(/body is required/);
    });
  });

  test("postProjectUpdate applies and returns the project-update URL", async () => {
    const update = {
      id: "pu2",
      body: "Status report",
      health: "offTrack",
      url: "https://linear.app/mirelo/project-update/pu2",
      createdAt: "2026-02-02T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z",
      user: { id: "u1", name: "Ada" },
    };
    await withMockGraphql(
      [projectsResponse(), { projectUpdateCreate: { success: true, projectUpdate: update } }],
      async (requests) => {
        const result = await postProjectUpdate("Transcriptor", {
          body: "Status report",
          health: "offTrack",
          apply: true,
        });

        expect(result.applied).toBe(true);
        expect(result.result?.url).toBe(update.url);
        expect(requests.at(-1)?.variables).toEqual({
          input: { projectId: "p1", body: "Status report", health: "offTrack" },
        });
      },
    );
  });

  test("listProjectUpdates resolves the project, applies the limit, and scopes the filter", async () => {
    await withMockGraphql(
      [
        projectsResponse(),
        projectUpdatesResponse([
          { id: "pu1", body: "First", health: "onTrack", url: "u1" },
          { id: "pu2", body: "Second", health: "atRisk", url: "u2" },
        ]),
      ],
      async (requests) => {
        const result = await listProjectUpdates("Transcriptor", { limit: 1 });

        expect(result.project.id).toBe("p1");
        expect(result.updates).toHaveLength(1);
        expect(requests[0]?.query).not.toContain("projectUpdates");
        expect(requests[0]?.variables.includeArchived).toBe(false);
        expect(requests.at(-1)?.variables).toMatchObject({
          filter: { project: { id: { eq: "p1" } } },
          includeArchived: false,
        });
      },
    );
  });

  test("issue search can filter by a project without a team", async () => {
    await withMockGraphql(
      [
        projectsResponse(),
        { issues: { nodes: [issueNode()], pageInfo: { hasNextPage: false, endCursor: null } } },
      ],
      async (requests) => {
        const issues = await searchIssues({ project: "Transcriptor", limit: 1 });

        expect(issues).toHaveLength(1);
        expect(requests.at(-1)?.variables.filter).toEqual({ project: { id: { eq: "p1" } } });
      },
    );
  });

  test("team-scoped issue project resolution follows issue archive policy", async () => {
    await withMockGraphql(
      [
        teamsResponse(),
        projectsResponse(),
        { issues: { nodes: [issueNode()], pageInfo: { hasNextPage: false, endCursor: null } } },
      ],
      async (requests) => {
        const issues = await searchIssues({
          team: "STU",
          project: "Transcriptor",
          includeArchived: true,
          limit: 1,
        });

        expect(issues).toHaveLength(1);
        expect(requests[1]?.query).not.toContain("projectUpdates");
        expect(requests[1]?.variables.includeArchived).toBe(true);
        expect(requests[2]?.variables.includeArchived).toBe(true);
      },
    );
  });

  test("archived project references require includeArchived consistently across scopes", async () => {
    const archivedProject = projectNode({ archivedAt: "2026-03-01T00:00:00.000Z" });

    await withMockGraphql([projectsResponse([archivedProject])], async () => {
      await expect(resolveProjectReference("Transcriptor")).rejects.toThrow(
        "No project found for: Transcriptor",
      );
    });

    await withMockGraphql(
      [
        teamsResponse(),
        projectsResponse([archivedProject]),
        { issues: { nodes: [issueNode()], pageInfo: { hasNextPage: false, endCursor: null } } },
      ],
      async (requests) => {
        await expect(
          searchIssues({ team: "STU", project: "Transcriptor", includeArchived: true, limit: 1 }),
        ).resolves.toHaveLength(1);
        expect(requests[1]?.variables.includeArchived).toBe(true);
        expect(requests[2]?.variables.includeArchived).toBe(true);
      },
    );
  });

  test("project reference matching preserves no-match and ambiguity errors", async () => {
    await withMockGraphql([projectsResponse([])], async () => {
      await expect(resolveProjectReference("Missing")).rejects.toThrow(
        "No project found for: Missing",
      );
    });

    await withMockGraphql(
      [
        projectsResponse([
          projectNode({ id: "p1", name: "Same" }),
          projectNode({ id: "p2", name: "Same" }),
        ]),
      ],
      async () => {
        await expect(resolveProjectReference("Same")).rejects.toThrow(
          "Project reference is ambiguous: Same",
        );
      },
    );
  });

  test("health validation accepts only the Linear enum values", () => {
    expect(parseProjectUpdateHealth("onTrack")).toBe("onTrack");
    expect(() => parseProjectUpdateHealth("On Track")).toThrow(ConfigError);
  });
});
