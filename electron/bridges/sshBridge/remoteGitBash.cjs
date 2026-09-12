/**
 * Resolve the interactive remote shell command for Windows OpenSSH + Git Bash.
 *
 * Local Windows already prefers Git Bash as the default shell. Remote Windows
 * OpenSSH still starts cmd/PowerShell from DefaultShell unless the session is
 * opened with `exec` + PTY. This module:
 *
 *   - treats `git-bash` as a sentinel that probes the remote install path
 *   - auto-prefers Git Bash on Windows OpenSSH when the host left the field empty
 *   - quotes `C:\Program Files\...` so the path does not depend on 8.3 names
 *   - classifies the resolved executable so AI exec uses a posix wrapper
 */
"use strict";

const { classifyLocalShellType } = require("../../../lib/localShell.cjs");
const { createSshConnExecProbe, isWindowsOpenSshRemote } = require("../ai/sessionShellKind.cjs");

const GIT_BASH_SENTINEL = "git-bash";
const DEFAULT_SHELL_SENTINEL = "default";
const GIT_BASH_ARGS = "--login -i";
const DEFAULT_PROBE_TIMEOUT_MS = 3000;

function trimRemoteShellCommand(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim();
}

function normalizeSentinelKey(raw) {
  return trimRemoteShellCommand(raw).toLowerCase().replace(/\s+/g, "-");
}

function isGitBashSentinel(raw) {
  const key = normalizeSentinelKey(raw);
  return key === GIT_BASH_SENTINEL || key === "gitbash";
}

function isDefaultShellSentinel(raw) {
  const key = normalizeSentinelKey(raw);
  return key === DEFAULT_SHELL_SENTINEL || key === "-" || key === "none";
}

/**
 * Quote a Windows `.exe` path that contains spaces so `cmd /c` / sshd exec
 * does not split on `Program Files`. Already-quoted commands are left alone.
 * 8.3 paths (`C:\PROGRA~1\...`) have no spaces and stay unquoted.
 */
function quoteWindowsRemoteCommand(command) {
  const trimmed = trimRemoteShellCommand(command);
  if (!trimmed || trimmed.startsWith('"')) return trimmed;
  const match = trimmed.match(/^([A-Za-z]:\\[^\n]+?\.(?:exe|bat|cmd|com))(\s+.*)?$/i);
  if (!match) return trimmed;
  const exe = match[1];
  const args = match[2] || "";
  if (!/\s/.test(exe)) return trimmed;
  return `"${exe}"${args}`;
}

function formatGitBashRemoteCommand(bashExe) {
  const normalized = String(bashExe || "").trim().replace(/\//g, "\\");
  if (!normalized) return "";
  const quoted = /\s/.test(normalized) ? `"${normalized}"` : normalized;
  return `${quoted} ${GIT_BASH_ARGS}`;
}

function extractCommandExecutable(command) {
  const trimmed = trimRemoteShellCommand(command);
  if (!trimmed) return "";
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    if (end > 1) return trimmed.slice(1, end);
  }
  const token = trimmed.split(/\s+/)[0] || "";
  return token.replace(/^"+|"+$/g, "");
}

function classifyRemoteShellKindFromCommand(command) {
  if (isGitBashSentinel(command)) return "posix";
  const executable = extractCommandExecutable(command);
  if (!executable) return null;
  const kind = classifyLocalShellType(executable, "linux");
  if (!kind || kind === "unknown") return null;
  return kind;
}

/**
 * Silent probe. Force `cmd.exe` so it works under both DefaultShell=cmd and
 * DefaultShell=powershell (same trick as the Windows login-shell probe).
 *
 * Avoid nested quotes inside `/c "..."`: `reg query` and `where` do not need
 * them. Parse the install path / git.exe location from the combined output.
 */
function buildRemoteGitBashProbeCommand() {
  return (
    'cmd.exe /d /s /c "reg query HKLM\\SOFTWARE\\GitForWindows /v InstallPath 2>&1'
    + " & where git 2>nul"
    + ' & where bash 2>nul"'
  );
}

function parseRemoteGitBashProbeOutput(text) {
  const normalized = String(text || "").replace(/\r/g, "");
  const sz = normalized.match(/InstallPath\s+REG_SZ\s+([^\n]+)/i);
  if (sz) {
    const installPath = sz[1].trim().replace(/^"+|"+$/g, "").replace(/[\\/]+$/, "");
    if (installPath) return `${installPath}\\bin\\bash.exe`;
  }
  for (const line of normalized.split("\n")) {
    const trimmed = line.trim().replace(/^"+|"+$/g, "");
    if (!trimmed) continue;
    const gitExe = trimmed.match(/^(.*)\\(?:cmd|bin)\\git\.exe$/i);
    if (gitExe) return `${gitExe[1]}\\bin\\bash.exe`;
    if (/\\bash\.exe$/i.test(trimmed) && /\\git\\/i.test(trimmed)) return trimmed;
  }
  return null;
}

async function probeRemoteGitBash(conn, options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_PROBE_TIMEOUT_MS);
  const execProbe = typeof options.execProbe === "function"
    ? options.execProbe
    : createSshConnExecProbe(conn);
  if (typeof execProbe !== "function") return null;
  const stdout = await execProbe(buildRemoteGitBashProbeCommand(), timeoutMs);
  if (stdout == null) return null;
  return parseRemoteGitBashProbeOutput(stdout);
}

function cacheKeyForRemoteShell(rawCommand, remoteSshVersion) {
  return `${normalizeSentinelKey(rawCommand)}|${String(remoteSshVersion || "")}`;
}

function readCachedRemoteShell(conn, rawCommand, remoteSshVersion) {
  const cache = conn && conn._netcattyResolvedRemoteShell;
  if (!cache || typeof cache !== "object") return undefined;
  if (cache.key !== cacheKeyForRemoteShell(rawCommand, remoteSshVersion)) return undefined;
  return cache.command;
}

function writeCachedRemoteShell(conn, rawCommand, remoteSshVersion, command) {
  if (!conn || typeof conn !== "object") return;
  conn._netcattyResolvedRemoteShell = {
    key: cacheKeyForRemoteShell(rawCommand, remoteSshVersion),
    command,
  };
}

/**
 * @returns {Promise<string>} exec command, or "" to keep `conn.shell()`
 */
async function resolveInteractiveRemoteShellCommand({
  rawCommand,
  remoteSshVersion,
  conn,
  probeGitBash,
  timeoutMs,
} = {}) {
  const raw = trimRemoteShellCommand(rawCommand);
  if (isDefaultShellSentinel(raw)) return "";

  const cached = readCachedRemoteShell(conn, raw, remoteSshVersion);
  if (cached !== undefined) return cached;

  const requireGitBash = isGitBashSentinel(raw);
  const autoGitBash = !raw && isWindowsOpenSshRemote(remoteSshVersion);
  if (!requireGitBash && !autoGitBash) {
    const command = quoteWindowsRemoteCommand(raw);
    writeCachedRemoteShell(conn, raw, remoteSshVersion, command);
    return command;
  }

  const probe = typeof probeGitBash === "function"
    ? probeGitBash
    : () => probeRemoteGitBash(conn, { timeoutMs });
  let bashExe = null;
  try {
    bashExe = await probe();
  } catch {
    bashExe = null;
  }
  const command = bashExe ? formatGitBashRemoteCommand(bashExe) : "";
  if (requireGitBash && !command) {
    const error = new Error(
      "Git Bash was not found on the remote Windows host. Install Git for Windows, or set a full path to bash.exe.",
    );
    error.code = "NETCATTY_REMOTE_GIT_BASH_MISSING";
    throw error;
  }
  writeCachedRemoteShell(conn, raw, remoteSshVersion, command);
  return command;
}

module.exports = {
  GIT_BASH_SENTINEL,
  DEFAULT_SHELL_SENTINEL,
  GIT_BASH_ARGS,
  trimRemoteShellCommand,
  isGitBashSentinel,
  isDefaultShellSentinel,
  quoteWindowsRemoteCommand,
  formatGitBashRemoteCommand,
  classifyRemoteShellKindFromCommand,
  buildRemoteGitBashProbeCommand,
  parseRemoteGitBashProbeOutput,
  probeRemoteGitBash,
  resolveInteractiveRemoteShellCommand,
};
