import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const workflowDirectory = join(import.meta.dirname, "..", ".github", "workflows");
const workflows = ["ci.yml", "publish.yml"].map((file) => join(workflowDirectory, file));
const publishWorkflow = join(workflowDirectory, "publish.yml");

describe("publish workflow trust policy", () => {
  test.each(workflows)("pins every third-party action in %s to a full commit SHA", async (path) => {
    const workflow = await readFile(path, "utf8");
    const actionRefs = Array.from(workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm), ([, ref]) => ref);

    expect(actionRefs.length).toBeGreaterThan(0);
    for (const ref of actionRefs) {
      expect(ref).toMatch(/@[a-f0-9]{40}$/);
    }
  });

  test("uses a pinned npm version and publishes only the packaged artifact", async () => {
    const workflow = await readFile(publishWorkflow, "utf8");

    expect(workflow).not.toContain("npm@latest");
    expect(workflow).toContain("npm@11.6.2");
    expect(workflow).toContain("needs: build");
    expect(workflow).toContain("npm publish package/*.tgz");
    expect(workflow).toContain("--provenance");
  });
});
