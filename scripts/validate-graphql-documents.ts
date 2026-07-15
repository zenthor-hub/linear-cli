#!/usr/bin/env bun
/**
 * Validate hand-written GraphQL documents in src/graphql/documents.ts against
 * the published Linear GraphQL schema.
 *
 * Downloads the schema from Linear's public SDK package when SCHEMA_PATH is unset.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildASTSchema, parse, validate } from "graphql";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCUMENTS_PATH = path.join(ROOT, "src/graphql/documents.ts");
const DEFAULT_CACHE = path.join(ROOT, ".cache/linear-schema.graphql");
const SCHEMA_URL =
  process.env.LINEAR_SCHEMA_URL ??
  "https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql";

async function loadSchemaSource(): Promise<string> {
  const explicit = process.env.SCHEMA_PATH?.trim();
  if (explicit) {
    return readFile(explicit, "utf8");
  }

  const cachePath = process.env.LINEAR_SCHEMA_CACHE?.trim() || DEFAULT_CACHE;
  try {
    const cached = await readFile(cachePath, "utf8");
    if (cached.length > 1000) return cached;
  } catch {
    // download below
  }

  const response = await fetch(SCHEMA_URL);
  if (!response.ok) {
    throw new Error(`Failed to download Linear schema: HTTP ${response.status}`);
  }
  const text = await response.text();
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, text, "utf8");
  return text;
}

type FragmentMap = Map<string, string>;

function extractTaggedTemplates(source: string): Array<{ name: string; body: string }> {
  const docs: Array<{ name: string; body: string }> = [];
  // Matches: export const NAME = /* GraphQL */ `...`  or  const NAME = /* GraphQL */ `...`
  const re = /(?:export\s+)?const ([A-Z0-9_]+) = \/\* GraphQL \*\/ `([\s\S]*?)`\s*;/g;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    const body = match[2];
    if (!name || body === undefined) continue;
    docs.push({ name, body });
  }
  return docs;
}

function expandInterpolations(body: string, fragments: FragmentMap, stack: string[] = []): string {
  return body.replace(/\$\{([A-Z0-9_]+)\}/g, (_full, name: string) => {
    if (stack.includes(name)) {
      throw new Error(`Circular GraphQL fragment interpolation: ${[...stack, name].join(" -> ")}`);
    }
    const fragment = fragments.get(name);
    if (fragment === undefined) {
      throw new Error(`Unknown GraphQL fragment interpolation: ${name}`);
    }
    return expandInterpolations(fragment, fragments, [...stack, name]);
  });
}

function extractOperations(source: string): Array<{ name: string; body: string }> {
  const templates = extractTaggedTemplates(source);
  const fragments: FragmentMap = new Map(templates.map((t) => [t.name, t.body]));
  const operations: Array<{ name: string; body: string }> = [];

  for (const template of templates) {
    const expanded = expandInterpolations(template.body, fragments);
    if (!/^\s*(query|mutation|subscription)\b/i.test(expanded)) continue;
    operations.push({ name: template.name, body: expanded });
  }
  return operations;
}

async function main(): Promise<void> {
  const schemaSource = await loadSchemaSource();
  const schema = buildASTSchema(parse(schemaSource));
  const documentsSource = await readFile(DOCUMENTS_PATH, "utf8");
  const documents = extractOperations(documentsSource);

  if (documents.length === 0) {
    throw new Error(`No GraphQL operations found in ${DOCUMENTS_PATH}`);
  }

  let failures = 0;
  for (const doc of documents) {
    try {
      const document = parse(doc.body);
      const errors = validate(schema, document);
      if (errors.length) {
        failures += 1;
        console.error(`\n${doc.name}:`);
        for (const error of errors) {
          console.error(`  - ${error.message}`);
        }
      } else {
        console.log(`ok  ${doc.name}`);
      }
    } catch (err) {
      failures += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n${doc.name}: parse error: ${message}`);
    }
  }

  console.log(`\nValidated ${documents.length} documents; ${failures} failed.`);
  if (failures > 0) process.exit(1);
}

await main();
