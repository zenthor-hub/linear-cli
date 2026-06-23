import { LINEAR_GRAPHQL_ENDPOINT, type Credential } from "../config.ts";
import { LinearGraphqlError, LinearHttpError, type GraphqlError } from "../errors.ts";
import { redactHeaders, redactText } from "../output/redact.ts";
import { computeBackoffMs, RETRYABLE_STATUS, sleep } from "./retry.ts";

export interface GraphqlResponse<T> {
  data?: T;
  errors?: GraphqlError[];
}

export interface ExecuteOptions {
  credential: Credential;
  debug?: boolean;
  /** Max retries for rate-limit / transient server errors. Default 3. */
  maxRetries?: number;
}

/**
 * Shared GraphQL executor. Treats a populated `errors` array as a failure even
 * when the HTTP status is 200, and only returns `data` after all error checks.
 */
export async function executeGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  options: ExecuteOptions,
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: options.credential.authorizationHeader,
  };

  if (options.debug) {
    process.stderr.write(
      `[debug] POST ${LINEAR_GRAPHQL_ENDPOINT}\n` +
        `[debug] headers ${JSON.stringify(redactHeaders(headers))}\n` +
        `[debug] variables ${redactText(JSON.stringify(variables), [options.credential.raw])}\n`,
    );
  }

  const maxRetries = options.maxRetries ?? 3;
  const requestBody = JSON.stringify({ query, variables });

  let response: Response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch(LINEAR_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers,
      body: requestBody,
    });

    if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
      const delay = computeBackoffMs(attempt, response.headers.get("retry-after"));
      if (options.debug) {
        process.stderr.write(
          `[debug] HTTP ${response.status}; retry ${attempt + 1}/${maxRetries} after ${delay}ms\n`,
        );
      }
      await sleep(delay);
      continue;
    }
    break;
  }

  let body: GraphqlResponse<T>;
  try {
    body = (await response.json()) as GraphqlResponse<T>;
  } catch {
    if (!response.ok) throw new LinearHttpError(response.status, null);
    throw new LinearGraphqlError([{ message: "Response was not valid JSON" }]);
  }

  if (!response.ok) {
    throw new LinearHttpError(response.status, body);
  }

  if (body.errors?.length) {
    throw new LinearGraphqlError(body.errors, body.data);
  }

  if (body.data === undefined || body.data === null) {
    throw new LinearGraphqlError([{ message: "Missing GraphQL data" }], body);
  }

  return body.data;
}
