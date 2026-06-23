import { Command } from "commander";

import { CliError } from "../errors.ts";
import { auditMutation, isApplied } from "../output/audit.ts";
import { errorEnvelope, printJson, successEnvelope } from "../output/format.ts";

export interface GlobalOptions {
  json?: boolean;
  debug?: boolean;
}

export function addGlobalOptions(program: Command): Command {
  return program
    .version("0.1.0")
    .option("--json", "emit machine-readable JSON envelopes")
    .option("--debug", "print redacted request diagnostics to stderr");
}

export function globals(command: Command): GlobalOptions {
  return command.optsWithGlobals() as GlobalOptions;
}

/**
 * Run a command body and render its result.
 *
 * Exit codes: 0 success; 2 for ConfigError/usage; 1 for any other failure.
 * `--json` output still exits non-zero on error.
 */
export async function run<T>(
  operation: string,
  global: GlobalOptions,
  body: () => Promise<T>,
  formatHuman: (data: T) => string,
): Promise<void> {
  try {
    const data = await body();
    if (isApplied(data)) {
      auditMutation(operation, data, new Date().toISOString());
    }
    if (global.json) {
      printJson(successEnvelope(operation, data));
    } else {
      process.stdout.write(`${formatHuman(data)}\n`);
    }
  } catch (err) {
    if (global.json) {
      printJson(errorEnvelope(operation, err));
    } else {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${message}\n`);
    }
    process.exitCode = err instanceof CliError ? err.exitCode : 1;
  }
}

export function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
