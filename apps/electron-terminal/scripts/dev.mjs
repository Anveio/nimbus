#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

const DEFAULT_TIMEOUT_MS = 5000;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const { timeoutMs, timeoutSource } = resolveTimeout();

let rendererProc = null;
let electronProc = null;
let shutdownTimer = null;
let shuttingDown = false;
let plannedExitCode = 0;

startRenderer();

process.on('SIGINT', () => {
  plannedExitCode = 0;
  console.log('\n[dev] Caught SIGINT, shutting down.');
  cleanup();
});

process.on('SIGTERM', () => {
  plannedExitCode = 0;
  console.log('\n[dev] Caught SIGTERM, shutting down.');
  cleanup();
});

function startRenderer() {
  rendererProc = spawn(
    npmCommand,
    ['run', 'build:renderer', '--', '--watch'],
    {
      stdio: 'inherit',
      env: { ...process.env },
    },
  );

  rendererProc.once('error', (err) => {
    if (shuttingDown) return;
    scheduleShutdown(`[dev] Renderer watch failed: ${err.message}`, 1);
  });

  rendererProc.once('spawn', () => {
    startElectron();
  });

  rendererProc.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const reason = signal
      ? `[dev] Renderer watch terminated by signal ${signal}`
      : code === 0
        ? '[dev] Renderer watch exited unexpectedly with code 0'
        : `[dev] Renderer watch exited with code ${code}`;
    scheduleShutdown(reason, code ?? 1);
  });
}

function startElectron() {
  const electronEnv = { ...process.env };
  if ('ELECTRON_RUN_AS_NODE' in electronEnv) {
    delete electronEnv.ELECTRON_RUN_AS_NODE;
  }

  electronProc = spawn(
    npxCommand,
    ['electron', 'out/main.js'],
    {
      stdio: 'inherit',
      env: electronEnv,
    },
  );

  electronProc.once('error', (err) => {
    if (shuttingDown) return;
    scheduleShutdown(`[dev] Electron process failed: ${err.message}`, 1);
  });

  electronProc.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const resolvedCode = code ?? (signal ? 1 : 0);
    const reason = signal
      ? `[dev] Electron terminated by signal ${signal}`
      : resolvedCode === 0
        ? '[dev] Electron exited.'
        : `[dev] Electron exited with code ${resolvedCode}`;
    scheduleShutdown(reason, resolvedCode);
  });
}

function scheduleShutdown(message, exitCode) {
  if (shutdownTimer || shuttingDown) return;
  if (exitCode && plannedExitCode === 0) {
    plannedExitCode = exitCode;
  }
  const effectiveTimeout = Math.max(timeoutMs, 0);
  const suffix = timeoutSource ? ` (from ${timeoutSource})` : '';
  if (effectiveTimeout === 0) {
    console.log(`${message} Exiting immediately${suffix}.`);
    cleanup();
    return;
  }
  console.log(`${message} Exiting in ${effectiveTimeout}ms${suffix}.`);
  shutdownTimer = setTimeout(() => {
    cleanup();
  }, effectiveTimeout);
}

function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }

  const children = [electronProc, rendererProc].filter(Boolean);
  if (children.length === 0) {
    process.exit(plannedExitCode);
    return;
  }

  let remaining = children.length;
  const maybeExit = () => {
    remaining -= 1;
    if (remaining <= 0) {
      process.exit(plannedExitCode);
    }
  };

  for (const child of children) {
    child.once('close', maybeExit);
    child.kill('SIGTERM');
  }

  setTimeout(() => {
    if (remaining > 0) {
      for (const child of children) {
        if (!child.killed) child.kill('SIGKILL');
      }
      process.exit(plannedExitCode);
    }
  }, 2000).unref();
}

function resolveTimeout() {
  const argValue = extractFlag('--timeout');
  const envValue = process.env.ELECTRON_DEV_EXIT_TIMEOUT_MS ?? process.env.DEV_EXIT_TIMEOUT_MS;
  const raw = argValue ?? envValue;
  if (!raw) {
    return { timeoutMs: DEFAULT_TIMEOUT_MS, timeoutSource: null };
  }
  if (raw === 'off' || raw === 'none' || raw === 'disable' || raw === 'disabled') {
    return { timeoutMs: 0, timeoutSource: formatSource(argValue, envValue) };
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    console.warn(`[dev] Invalid timeout value "${raw}". Using default ${DEFAULT_TIMEOUT_MS}ms.`);
    return { timeoutMs: DEFAULT_TIMEOUT_MS, timeoutSource: null };
  }
  return { timeoutMs: parsed, timeoutSource: formatSource(argValue, envValue) };
}

function extractFlag(flag) {
  const direct = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (direct) {
    const [, value] = direct.split('=');
    return value;
  }
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return null;
}

function formatSource(argValue, envValue) {
  if (argValue) return '--timeout flag';
  if (envValue) return envValue === process.env.ELECTRON_DEV_EXIT_TIMEOUT_MS
    ? 'ELECTRON_DEV_EXIT_TIMEOUT_MS'
    : 'DEV_EXIT_TIMEOUT_MS';
  return null;
}
