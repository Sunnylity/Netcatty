"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  GIT_BASH_SENTINEL,
  DEFAULT_SHELL_SENTINEL,
  isGitBashSentinel,
  isDefaultShellSentinel,
  quoteWindowsRemoteCommand,
  formatGitBashRemoteCommand,
  classifyRemoteShellKindFromCommand,
  buildRemoteGitBashProbeCommand,
  parseRemoteGitBashProbeOutput,
  resolveInteractiveRemoteShellCommand,
} = require("./remoteGitBash.cjs");

test("git-bash and default sentinels normalize aliases", () => {
  assert.equal(isGitBashSentinel("git-bash"), true);
  assert.equal(isGitBashSentinel(" Git Bash "), true);
  assert.equal(isGitBashSentinel("gitbash"), true);
  assert.equal(isGitBashSentinel("bash -l"), false);
  assert.equal(isDefaultShellSentinel(DEFAULT_SHELL_SENTINEL), true);
  assert.equal(isDefaultShellSentinel("-"), true);
  assert.equal(isDefaultShellSentinel("none"), true);
  assert.equal(isDefaultShellSentinel(""), false);
});

test("quoteWindowsRemoteCommand quotes Program Files without relying on 8.3 names", () => {
  assert.equal(
    quoteWindowsRemoteCommand("C:\\Program Files\\Git\\bin\\bash.exe -l"),
    '"C:\\Program Files\\Git\\bin\\bash.exe" -l',
  );
  assert.equal(
    quoteWindowsRemoteCommand("C:\\PROGRA~1\\Git\\bin\\bash.exe -l"),
    "C:\\PROGRA~1\\Git\\bin\\bash.exe -l",
  );
  assert.equal(
    quoteWindowsRemoteCommand('"C:\\Program Files\\Git\\bin\\bash.exe" --login -i'),
    '"C:\\Program Files\\Git\\bin\\bash.exe" --login -i',
  );
  assert.equal(quoteWindowsRemoteCommand("bash -l"), "bash -l");
});

test("formatGitBashRemoteCommand uses login + interactive args", () => {
  assert.equal(
    formatGitBashRemoteCommand("C:\\Program Files\\Git\\bin\\bash.exe"),
    '"C:\\Program Files\\Git\\bin\\bash.exe" --login -i',
  );
  assert.equal(
    formatGitBashRemoteCommand("C:\\PROGRA~1\\Git\\bin\\bash.exe"),
    "C:\\PROGRA~1\\Git\\bin\\bash.exe --login -i",
  );
});

test("classifyRemoteShellKindFromCommand maps bash.exe to posix", () => {
  assert.equal(classifyRemoteShellKindFromCommand(GIT_BASH_SENTINEL), "posix");
  assert.equal(
    classifyRemoteShellKindFromCommand('"C:\\Program Files\\Git\\bin\\bash.exe" --login -i'),
    "posix",
  );
  assert.equal(classifyRemoteShellKindFromCommand("powershell.exe -NoLogo"), "powershell");
  assert.equal(classifyRemoteShellKindFromCommand("cmd.exe"), "cmd");
  assert.equal(classifyRemoteShellKindFromCommand(""), null);
});

test("parseRemoteGitBashProbeOutput prefers GitForWindows InstallPath", () => {
  const registry = [
    "HKEY_LOCAL_MACHINE\\SOFTWARE\\GitForWindows",
    "    InstallPath    REG_SZ    C:\\Program Files\\Git",
  ].join("\r\n");
  assert.equal(
    parseRemoteGitBashProbeOutput(registry),
    "C:\\Program Files\\Git\\bin\\bash.exe",
  );
});

test("parseRemoteGitBashProbeOutput falls back to where git/bash", () => {
  assert.equal(
    parseRemoteGitBashProbeOutput("C:\\Git\\cmd\\git.exe\n"),
    "C:\\Git\\bin\\bash.exe",
  );
  assert.equal(
    parseRemoteGitBashProbeOutput("C:\\Users\\me\\scoop\\apps\\git\\current\\bin\\bash.exe\n"),
    "C:\\Users\\me\\scoop\\apps\\git\\current\\bin\\bash.exe",
  );
  assert.equal(parseRemoteGitBashProbeOutput("ERROR: The system cannot find the file specified."), null);
});

test("Git Bash probe forces cmd.exe so powershell DefaultShell still runs it", () => {
  const command = buildRemoteGitBashProbeCommand();
  assert.match(command, /^cmd\.exe \/d \/s \/c /);
  assert.match(command, /GitForWindows/);
  assert.match(command, /where git/);
  assert.match(command, /where bash/);
});

test("empty command on Windows OpenSSH auto-prefers probed Git Bash", async () => {
  const command = await resolveInteractiveRemoteShellCommand({
    rawCommand: "",
    remoteSshVersion: "OpenSSH_for_Windows_9.5",
    probeGitBash: async () => "C:\\Program Files\\Git\\bin\\bash.exe",
  });
  assert.equal(command, '"C:\\Program Files\\Git\\bin\\bash.exe" --login -i');
});

test("empty command on Windows OpenSSH falls back to DefaultShell when Git Bash is missing", async () => {
  const command = await resolveInteractiveRemoteShellCommand({
    rawCommand: "",
    remoteSshVersion: "OpenSSH_for_Windows_9.5",
    probeGitBash: async () => null,
  });
  assert.equal(command, "");
});

test("default sentinel skips auto Git Bash on Windows OpenSSH", async () => {
  const command = await resolveInteractiveRemoteShellCommand({
    rawCommand: "default",
    remoteSshVersion: "OpenSSH_for_Windows_9.5",
    probeGitBash: async () => {
      throw new Error("should not probe");
    },
  });
  assert.equal(command, "");
});

test("git-bash sentinel errors when the remote install is missing", async () => {
  await assert.rejects(
    () => resolveInteractiveRemoteShellCommand({
      rawCommand: "git-bash",
      remoteSshVersion: "OpenSSH_for_Windows_9.5",
      probeGitBash: async () => null,
    }),
    /Git Bash was not found/,
  );
});

test("explicit Program Files paths are quoted and POSIX banners skip auto Git Bash", async () => {
  assert.equal(
    await resolveInteractiveRemoteShellCommand({
      rawCommand: "C:\\Program Files\\Git\\bin\\bash.exe -l",
      remoteSshVersion: "OpenSSH_9.8",
      probeGitBash: async () => {
        throw new Error("should not probe");
      },
    }),
    '"C:\\Program Files\\Git\\bin\\bash.exe" -l',
  );
  assert.equal(
    await resolveInteractiveRemoteShellCommand({
      rawCommand: "",
      remoteSshVersion: "OpenSSH_9.8",
      probeGitBash: async () => {
        throw new Error("should not probe");
      },
    }),
    "",
  );
});

test("resolved Git Bash command is cached on the SSH client", async () => {
  const conn = {};
  let probes = 0;
  const first = await resolveInteractiveRemoteShellCommand({
    rawCommand: "git-bash",
    remoteSshVersion: "OpenSSH_for_Windows_9.5",
    conn,
    probeGitBash: async () => {
      probes += 1;
      return "C:\\Git\\bin\\bash.exe";
    },
  });
  const second = await resolveInteractiveRemoteShellCommand({
    rawCommand: "git-bash",
    remoteSshVersion: "OpenSSH_for_Windows_9.5",
    conn,
    probeGitBash: async () => {
      probes += 1;
      return "C:\\Git\\bin\\bash.exe";
    },
  });
  assert.equal(first, "C:\\Git\\bin\\bash.exe --login -i");
  assert.equal(second, first);
  assert.equal(probes, 1);
});
