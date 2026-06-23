import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { resolveCredential } from "../config.ts";
import { ConfigError } from "../errors.ts";
import { executeGraphql } from "../graphql/client.ts";
import { documentContainsMutation } from "../safety/mutation.ts";

export interface GqlOptions {
  vars?: string;
  apply?: boolean;
  debug?: boolean;
}

export interface GqlData {
  isMutation: boolean;
  applied: boolean;
  result: unknown;
}

/**
 * Run an explicit GraphQL document from a `.graphql` file.
 *
 * Decision: every mutation is dry-run by default; `--apply` is required to
 * execute one. Queries always execute (they have no side effects).
 */
export async function runGql(file: string, options: GqlOptions): Promise<GqlData> {
  if (extname(file) !== ".graphql") {
    throw new ConfigError(`GraphQL document must be a .graphql file (got: ${file})`);
  }

  const source = await readFile(file, "utf8").catch(() => {
    throw new ConfigError(`Could not read GraphQL file: ${file}`);
  });

  let variables: Record<string, unknown> = {};
  if (options.vars) {
    if (extname(options.vars) !== ".json") {
      throw new ConfigError(`Variables file must be JSON (got: ${options.vars})`);
    }
    const raw = await readFile(options.vars, "utf8").catch(() => {
      throw new ConfigError(`Could not read variables file: ${options.vars}`);
    });
    try {
      variables = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConfigError(`Variables file is not valid JSON: ${message}`);
    }
  }

  const isMutation = documentContainsMutation(source);

  if (isMutation && !options.apply) {
    return { isMutation, applied: false, result: null };
  }

  const credential = resolveCredential();
  const result = await executeGraphql<unknown>(source, variables, {
    credential,
    debug: options.debug,
  });

  return { isMutation, applied: isMutation, result };
}
