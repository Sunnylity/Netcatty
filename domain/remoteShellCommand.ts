/**
 * Sentinels for Host.remoteShellCommand.
 *
 * `git-bash` is resolved at connect time by probing the remote Windows host
 * for Git for Windows (registry / `where git` / `where bash`) and opening the
 * session with `exec` + PTY. `default` forces the server DefaultShell even on
 * Windows OpenSSH, where an empty value otherwise auto-prefers Git Bash.
 */
export const REMOTE_SHELL_GIT_BASH_SENTINEL = "git-bash";
export const REMOTE_SHELL_DEFAULT_SENTINEL = "default";
