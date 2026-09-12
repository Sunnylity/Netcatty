/**
 * Windows path dialects used by Git Bash, Windows OpenSSH SFTP, and Win32.
 *
 * Git Bash $PWD / OSC 7 (cygpath -u): `/c/Users/foo`
 * Git Bash OSC 7 (cygpath -m):        `/C:/Users/foo`
 * Windows OpenSSH SFTP:               `/C:/Users/foo`
 * Win32 / local filesystem:           `C:\Users\foo`
 */

const OPENSSH_DRIVE = /^\/([A-Za-z]):(?:\/(.*))?$/;
const CYGDRIVE = /^\/([A-Za-z])(?:\/(.*))?$/;
const WIN32_DRIVE = /^([A-Za-z]):[\\/](.*)$/;
const WIN32_DRIVE_ROOT = /^([A-Za-z]):[\\/]?$/;

/** `/C:/Users/foo` as exposed by Windows OpenSSH SFTP. */
export function isWindowsOpenSshSftpPath(path: string): boolean {
  return OPENSSH_DRIVE.test(path);
}

/**
 * Git Bash / MSYS cygdrive: a single-letter first segment (`/c/Users`).
 * `/usr/bin` and `/home/user` do not match because the first segment is
 * longer than one letter.
 */
export function isMsysCygdrivePath(path: string): boolean {
  if (path.includes(":")) return false;
  return CYGDRIVE.test(path);
}

export function isWindowsSftpContextPath(path: string | null | undefined): boolean {
  if (!path) return false;
  if (/^[A-Za-z]:/.test(path)) return true;
  if (isWindowsOpenSshSftpPath(path)) return true;
  if (isMsysCygdrivePath(path)) return true;
  return /^\\\\/.test(path);
}

function joinOpenSsh(drive: string, rest: string): string {
  const letter = drive.toUpperCase();
  return rest ? `/${letter}:/${rest.replace(/\\/g, "/")}` : `/${letter}:/`;
}

function joinCygdrive(drive: string, rest: string): string {
  const letter = drive.toLowerCase();
  return rest ? `/${letter}/${rest.replace(/\\/g, "/")}` : `/${letter}`;
}

function joinWin32Mixed(drive: string, rest: string): string {
  const letter = drive.toUpperCase();
  return rest ? `${letter}:/${rest.replace(/\\/g, "/")}` : `${letter}:/`;
}

function splitWindowsUserPath(path: string): { drive: string; rest: string } | null {
  const openSsh = path.match(OPENSSH_DRIVE);
  if (openSsh) return { drive: openSsh[1], rest: openSsh[2] ?? "" };
  if (!path.includes(":")) {
    const cyg = path.match(CYGDRIVE);
    if (cyg) return { drive: cyg[1], rest: cyg[2] ?? "" };
  }
  const winRoot = path.match(WIN32_DRIVE_ROOT);
  if (winRoot) return { drive: winRoot[1], rest: "" };
  const win = path.match(WIN32_DRIVE);
  if (win) return { drive: win[1], rest: win[2] };
  return null;
}

/** Git Bash `cd` argument: `/C:/Users/foo` and `C:\Users\foo` become `/c/Users/foo`. */
export function toMsysCygdrivePath(path: string): string | null {
  const parts = splitWindowsUserPath(path);
  if (!parts) return null;
  return joinCygdrive(parts.drive, parts.rest);
}

/** Windows OpenSSH SFTP path: `/c/Users/foo` and `C:\Users\foo` become `/C:/Users/foo`. */
export function toWindowsOpenSshSftpPath(path: string): string | null {
  const parts = splitWindowsUserPath(path);
  if (!parts) return null;
  return joinOpenSsh(parts.drive, parts.rest);
}

/**
 * Translate a Git Bash cwd into the dialect of an SFTP pane.
 * POSIX panes (`/home/...`) are left unchanged so a directory named `c` stays intact.
 */
export function translateGitBashCwdForSftpPane(
  path: string,
  ...contextPaths: Array<string | null | undefined>
): string {
  if (!contextPaths.some((hint) => isWindowsSftpContextPath(hint))) return path;
  const parts = splitWindowsUserPath(path);
  if (!parts) return path;
  const openSshContext = contextPaths.some((hint) => hint && isWindowsOpenSshSftpPath(hint));
  const cygContext = contextPaths.some((hint) => hint && isMsysCygdrivePath(hint));
  if (openSshContext || cygContext) return joinOpenSsh(parts.drive, parts.rest);
  return joinWin32Mixed(parts.drive, parts.rest);
}

function canonicalizeWindowsUserPath(path: string): string | null {
  const parts = splitWindowsUserPath(path);
  if (!parts) return null;
  const rest = parts.rest.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return rest ? `${parts.drive.toLowerCase()}:/${rest}` : `${parts.drive.toLowerCase()}:/`;
}

/** True when Git Bash `/c/Users/foo` and OpenSSH `/C:/Users/foo` name the same folder. */
export function windowsUserPathsReferToSameLocation(a: string, b: string): boolean {
  if (a === b) return true;
  const left = canonicalizeWindowsUserPath(a);
  const right = canonicalizeWindowsUserPath(b);
  return left !== null && right !== null && left === right;
}
