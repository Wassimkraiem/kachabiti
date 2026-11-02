#!/usr/bin/env node
/**
 * Launch Next with a longer Happy Eyeballs timeout.
 *
 * Node waits 250 ms by default before trying the next address. On a slow
 * network that times out the connection to the API, and middleware then
 * treats a signed-in admin as signed out. Setting NODE_OPTIONS here works in
 * Windows cmd and Unix shells, and child processes inherit the flag.
 *
 *   node scripts/run-next.mjs dev --turbopack
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const FLAG = '--network-family-autoselection-attempt-timeout=2000';
const existing = process.env.NODE_OPTIONS ?? '';
if (!existing.includes('network-family-autoselection-attempt-timeout')) {
  process.env.NODE_OPTIONS = `${existing} ${FLAG}`.trim();
}

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
