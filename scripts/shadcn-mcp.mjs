#!/usr/bin/env node
/**
 * Launches the shadcn MCP server with its working directory set to apps/web.
 *
 * Why this wrapper exists: shadcn v4 resolves `components.json` (and therefore
 * the configured registries) from the PROCESS working directory. Its `--cwd`
 * flag does not affect that lookup — verified against v4.19.0 with both a
 * relative and an absolute path, which both yielded zero registries.
 *
 * Claude Code starts MCP servers in the project root and its `.mcp.json` stdio
 * schema has no `cwd` field, so the directory has to be set by the command
 * itself. `stdio: 'inherit'` hands the child the real stdin/stdout, which is
 * exactly what an stdio MCP server needs.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web');

const child = spawn('npx', ['-y', 'shadcn@latest', 'mcp'], {
  cwd: webDir,
  stdio: 'inherit',
  // On Windows npx is a .cmd shim, which spawn cannot execute directly.
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(`Failed to start shadcn MCP server: ${err.message}`);
  process.exit(1);
});
