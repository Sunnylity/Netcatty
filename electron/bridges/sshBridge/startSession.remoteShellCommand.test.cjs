"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  openInteractiveChannel,
  resolveRemoteShellCommand,
  shouldSkipShellPidDiscovery,
} = require("./startSession.cjs");

const WINDOW_OPTIONS = { term: "xterm-256color", cols: 80, rows: 24 };
const SHELL_OPTIONS = { env: { FOO: "bar" } };

function createClient() {
  const calls = [];
  const client = {
    calls,
    shell(windowOptions, shellOptions, callback) {
      calls.push({ kind: "shell", windowOptions, shellOptions });
      callback(null, { kind: "shell-stream" });
    },
    exec(command, options, callback) {
      calls.push({ kind: "exec", command, options });
      callback(null, { kind: "exec-stream" });
    },
  };
  return client;
}

function openChannel(client, remoteShellCommand) {
  return new Promise((resolve, reject) => {
    openInteractiveChannel(
      client,
      {
        windowOptions: WINDOW_OPTIONS,
        shellOptions: SHELL_OPTIONS,
        remoteShellCommand,
      },
      (error, stream) => (error ? reject(error) : resolve(stream)),
      {},
    );
  });
}

test("resolveRemoteShellCommand trims and normalizes non-strings", () => {
  assert.equal(resolveRemoteShellCommand({ remoteShellCommand: "  bash -l  " }), "bash -l");
  assert.equal(resolveRemoteShellCommand({ remoteShellCommand: "" }), "");
  assert.equal(resolveRemoteShellCommand({ remoteShellCommand: "   " }), "");
  assert.equal(resolveRemoteShellCommand({ remoteShellCommand: 42 }), "");
  assert.equal(resolveRemoteShellCommand({}), "");
  assert.equal(resolveRemoteShellCommand(), "");
});

test("a remote shell command implies skipping POSIX shell-PID discovery", () => {
  assert.equal(shouldSkipShellPidDiscovery({}), false);
  assert.equal(shouldSkipShellPidDiscovery({ skipShellPidDiscovery: true }), true);
  assert.equal(shouldSkipShellPidDiscovery({ remoteShellCommand: "bash -l" }), true);
  assert.equal(shouldSkipShellPidDiscovery({ remoteShellCommand: "  " }), false);
});

test("remote shell command opens the session with exec + PTY", async () => {
  const client = createClient();
  const stream = await openChannel(client, "C:\\PROGRA~1\\Git\\bin\\bash.exe -l");

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].kind, "exec");
  assert.equal(client.calls[0].command, "C:\\PROGRA~1\\Git\\bin\\bash.exe -l");
  // The PTY window options replace the server DefaultShell, so the command
  // owns the terminal and `env` is forwarded from the shell request.
  assert.deepEqual(client.calls[0].options.pty, WINDOW_OPTIONS);
  assert.deepEqual(client.calls[0].options.env, SHELL_OPTIONS.env);
  assert.equal(stream.kind, "exec-stream");
});

test("no remote shell command keeps the server DefaultShell (shell request)", async () => {
  for (const value of [undefined, null, "", "   "]) {
    const client = createClient();
    const stream = await openChannel(client, value);

    assert.equal(client.calls.length, 1, `value=${String(value)}`);
    assert.equal(client.calls[0].kind, "shell", `value=${String(value)}`);
    assert.deepEqual(client.calls[0].windowOptions, WINDOW_OPTIONS);
    assert.equal(stream.kind, "shell-stream");
  }
});

test("both interactive call shapes share one callback contract", async () => {
  // The exec and shell paths must stay interchangeable: same (err, stream)
  // callback, same window options, so the session wiring downstream (resize via
  // Channel.setWindow, exit/close handling) does not branch on which one ran.
  const execClient = createClient();
  const shellClient = createClient();
  const execStream = await openChannel(execClient, "bash -l");
  const shellStream = await openChannel(shellClient, "");

  assert.ok(execStream);
  assert.ok(shellStream);
  assert.deepEqual(
    execClient.calls[0].options.pty,
    shellClient.calls[0].windowOptions,
  );
});

test("git-bash sentinel opens exec + PTY with the probed path", async () => {
  const client = createClient();
  const sessionOptions = { remoteShellCommand: "git-bash" };
  const stream = await new Promise((resolve, reject) => {
    openInteractiveChannel(
      client,
      {
        windowOptions: WINDOW_OPTIONS,
        shellOptions: SHELL_OPTIONS,
        remoteShellCommand: "git-bash",
        sessionOptions,
      },
      (error, nextStream) => (error ? reject(error) : resolve(nextStream)),
      {
        probeGitBash: async () => "C:\\Program Files\\Git\\bin\\bash.exe",
      },
    );
  });

  assert.equal(stream.kind, "exec-stream");
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].kind, "exec");
  assert.equal(client.calls[0].command, '"C:\\Program Files\\Git\\bin\\bash.exe" --login -i');
  assert.equal(
    sessionOptions._resolvedRemoteShellCommand,
    '"C:\\Program Files\\Git\\bin\\bash.exe" --login -i',
  );
  assert.equal(shouldSkipShellPidDiscovery(sessionOptions), true);
});

test("Windows OpenSSH auto Git Bash still skips POSIX shell-PID discovery", () => {
  assert.equal(
    shouldSkipShellPidDiscovery({
      _resolvedRemoteShellCommand: '"C:\\Program Files\\Git\\bin\\bash.exe" --login -i',
    }),
    true,
  );
});
