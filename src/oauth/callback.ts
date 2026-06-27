import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { ConfigError } from "../errors.ts";

export interface CallbackResult {
  code: string;
  state: string;
}

export function parseRedirectUri(redirectUri: string): {
  host: string;
  port: number;
  pathname: string;
} {
  const url = new URL(redirectUri);
  if (url.protocol !== "http:") {
    throw new ConfigError("OAuth redirect URI must use http (local callback only).");
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new ConfigError("OAuth redirect URI must bind to 127.0.0.1 or localhost.");
  }
  const port = url.port ? Number(url.port) : 80;
  return { host: url.hostname, port, pathname: url.pathname };
}

function readQuery(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  return url.searchParams;
}

export async function waitForOAuthCallback(input: {
  redirectUri: string;
  expectedState: string;
  timeoutMs: number;
}): Promise<CallbackResult> {
  const { host, port, pathname } = parseRedirectUri(input.redirectUri);

  return new Promise<CallbackResult>((resolve, reject) => {
    let settled = false;
    let server: Server;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => fn());
    };

    const timer = setTimeout(() => {
      finish(() => reject(new ConfigError("OAuth login timed out waiting for callback.")));
    }, input.timeoutMs);

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const query = readQuery(req);
      const reqPath = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

      if (reqPath !== pathname) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found");
        return;
      }

      const error = query.get("error");
      if (error) {
        const description = query.get("error_description") ?? error;
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end("<h1>Linear login failed</h1><p>You can close this window.</p>");
        finish(() => reject(new ConfigError(`OAuth authorization failed: ${description}`)));
        return;
      }

      const code = query.get("code");
      const state = query.get("state");
      if (!code || !state) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("Missing code or state");
        finish(() => reject(new ConfigError("OAuth callback missing code or state.")));
        return;
      }

      if (state !== input.expectedState) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("Invalid state");
        finish(() => reject(new ConfigError("OAuth state mismatch — possible CSRF.")));
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<h1>Linear login complete</h1><p>You can close this window and return to the CLI.</p>",
      );
      finish(() => resolve({ code, state }));
    });

    server.on("error", (err) => {
      finish(() => reject(err));
    });

    server.listen(port, host);
  });
}
