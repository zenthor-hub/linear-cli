# Security Policy

## Supported Versions

Security fixes are provided for the latest release on npm. Older versions are not supported.

| Version | Supported |
| ------- | --------- |
| latest  | yes       |

## Reporting a Vulnerability

If you discover a security issue, please report it privately rather than opening a public issue.

Preferred contact:

- GitHub Security Advisories: https://github.com/zenthor-hub/linear-cli/security/advisories/new

Include as much detail as possible:

- Affected command or code path
- Steps to reproduce
- Impact assessment
- Suggested fix, if you have one

We aim to acknowledge reports within 3 business days and provide an initial assessment within 7 business days.

## Scope

This policy covers:

- The `linear` and `linear-admin` CLIs in this repository
- OAuth credential storage under `~/.config/linear-cli/`
- Token handling, redaction, and mutation safety defaults

Out of scope:

- Vulnerabilities in Linear's hosted API or web application
- Issues caused by sharing API keys, OAuth tokens, or credential files

## Safe Defaults

This CLI is designed for agent and automation use:

- Bulk and destructive commands default to dry-run mode; `--apply` is required to mutate data.
- Authorization headers and token values are redacted in logs and audit output.
- Secrets should be provided via environment variables or the local OAuth credential store, not committed to source control.

When reporting issues, avoid including real API keys, access tokens, or credential file contents.
