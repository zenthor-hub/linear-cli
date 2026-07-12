import { Command } from "commander";
import { describe, expect, test } from "vitest";

import { addAuthCommands, addAuthTokenCommand } from "../src/cli/auth.ts";

describe("authentication command composition", () => {
  test("declares the selected login scope as the Commander default", () => {
    const program = new Command();
    const auth = addAuthCommands(program, { defaultScope: "read,admin" });
    const login = auth.commands.find((command) => command.name() === "login");

    expect(login?.getOptionValue("scope")).toBe("read,admin");
    expect(login?.helpInformation()).toContain('(default: "read,admin")');
  });

  test("registers the client-credentials command only through explicit composition", () => {
    const regularAuth = addAuthCommands(new Command(), { defaultScope: "read" });
    expect(regularAuth.commands.map((command) => command.name())).not.toContain("token");

    const adminAuth = addAuthCommands(new Command(), { defaultScope: "read,admin" });
    addAuthTokenCommand(adminAuth);
    expect(adminAuth.commands.map((command) => command.name())).toContain("token");
  });
});
