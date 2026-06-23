/**
 * Typed error hierarchy for the CLI.
 *
 * Exit-code contract (consumed in cli.ts):
 *   - ConfigError / usage problems         -> exit 2
 *   - LinearHttpError / LinearGraphqlError /
 *     any other runtime failure            -> exit 1
 *   - success                              -> exit 0
 */

export type GraphqlError = {
  message: string;
  path?: readonly (string | number)[];
  extensions?: unknown;
};

/** Base class so the CLI can recognise our own errors. */
export class CliError extends Error {
  readonly type: string = "CliError";
  /** Process exit code to use when this error reaches the top level. */
  readonly exitCode: number = 1;
}

/** Configuration / credential / usage problems. Exit code 2. */
export class ConfigError extends CliError {
  override readonly type = "ConfigError";
  override readonly exitCode = 2;
}

/** Non-2xx HTTP response from the Linear API. */
export class LinearHttpError extends CliError {
  override readonly type = "LinearHttpError";
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Linear API returned HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** GraphQL `errors` present in the response (even with HTTP 200). */
export class LinearGraphqlError extends CliError {
  override readonly type = "LinearGraphqlError";
  readonly errors: readonly GraphqlError[];
  readonly data: unknown;

  constructor(errors: readonly GraphqlError[], data?: unknown) {
    const summary = errors.map((e) => e.message).join("; ") || "Unknown GraphQL error";
    super(summary);
    this.errors = errors;
    this.data = data;
  }
}
