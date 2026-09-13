import type { DataRelayWriteMode } from "./models/dataRelay";
import type { HostOperatingSystem } from "./models/connection";

export type DataRelayFollowOs = HostOperatingSystem | "linux" | "windows" | "macos";

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC = /^\\\\/;

export function getDataRelayFileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

export function usesWindowsDataRelayPath(path: string): boolean {
  return WINDOWS_DRIVE.test(path) || WINDOWS_UNC.test(path) || (path.includes("\\") && !path.startsWith("/"));
}

export function isDataRelayDirectoryHint(path: string): boolean {
  return /[\\/]$/.test(path);
}

export function toDataRelayDirectoryHint(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || isDataRelayDirectoryHint(trimmed)) return trimmed;
  return usesWindowsDataRelayPath(trimmed) ? `${trimmed}\\` : `${trimmed}/`;
}

export function joinDataRelayPath(base: string, name: string): string {
  const fileName = name.trim();
  if (!fileName) return base;
  const root = base.trim();
  if (!root) return fileName;
  if (usesWindowsDataRelayPath(root)) {
    const normalized = root.replace(/[\\/]+$/, "");
    return `${normalized}\\${fileName}`;
  }
  if (root === "/") return `/${fileName}`;
  return `${root.replace(/\/+$/, "")}/${fileName}`;
}

/**
 * True when `browsePath` sits inside `sourceRoot` (or equals it). Windows-
 * style roots compare case-insensitively and tolerate mixed separators; the
 * segment boundary is honored so /src-other is not "under" /src.
 */
export function isDataRelayPathUnderRoot(sourceRoot: string, browsePath: string): boolean {
  const root = stripDataRelayTrailingSep(sourceRoot);
  const browse = stripDataRelayTrailingSep(browsePath);
  if (!root) return true;
  if (!browse) return false;
  if (usesWindowsDataRelayPath(root)) {
    const rootNormalized = root.replace(/\\/g, "/").toLowerCase();
    const browseNormalized = browse.replace(/\\/g, "/").toLowerCase();
    return browseNormalized === rootNormalized || browseNormalized.startsWith(`${rootNormalized}/`);
  }
  return browse === root || browse.startsWith(`${root}/`);
}

/**
 * Mirror one browsed subdirectory's position under its sync root for a
 * one-shot upload: the relative path inside the source root is replayed under
 * the destination root; when the panes browsed outside the root the subtree
 * lands at the destination root's top level.
 */
export function dataRelaySubdirUploadRelativeDir(
  sourceRoot: string,
  browsePath: string,
  name: string,
): string {
  const root = stripDataRelayTrailingSep(sourceRoot);
  const browse = stripDataRelayTrailingSep(browsePath);
  if (root && browse) {
    if (usesWindowsDataRelayPath(root)) {
      // Saved rule paths and browsed SFTP paths may mix \ and / on Windows;
      // compare on normalized forward slashes so both spellings match.
      const rootNormalized = root.replace(/\\/g, "/").toLowerCase();
      const browseNormalized = browse.replace(/\\/g, "/");
      if (browseNormalized.toLowerCase().startsWith(rootNormalized)) {
        const rel = browseNormalized.slice(rootNormalized.length).replace(/^\/+/, "");
        return rel ? `${rel}/${name}` : name;
      }
    } else if (browse.startsWith(root)) {
      const rel = browse.slice(root.length).replace(/^\/+/, "");
      return rel ? `${rel}/${name}` : name;
    }
  }
  return name;
}

/**
 * When the destination is a directory (trailing slash), write into a file
 * named after the source. Concrete file paths are left unchanged.
 */
export function resolveDataRelayDestPath(sourcePath: string, destPath: string): string {
  const dest = destPath.trim();
  if (!dest || !isDataRelayDirectoryHint(dest)) return dest;
  const fileName = getDataRelayFileName(sourcePath.trim());
  if (!fileName) return dest;
  return joinDataRelayPath(dest, fileName);
}

export function stripDataRelayTrailingSep(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  if (trimmed === "/" || /^[A-Za-z]:\\?$/.test(trimmed)) return trimmed.replace(/\/+$/, "") || trimmed;
  return trimmed.replace(/[\\/]+$/, "");
}

function isAbsoluteDataRelayPath(path: string): boolean {
  return path.startsWith("/") || usesWindowsDataRelayPath(path);
}

/**
 * Resolve a saved relay folder into the directory the dual-pane viewer should
 * list. Expands ~ against the remote home and keeps relative paths under home.
 */
export function resolveDataRelayViewerStart(
  configuredPath: string | undefined,
  homeDir: string,
): { listPath: string } {
  const home = stripDataRelayTrailingSep(homeDir || "") || "/";
  const trimmed = (configuredPath ?? "").trim();
  if (!trimmed) return { listPath: home };

  let path = trimmed;
  if (path === "~") return { listPath: home };
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    path = joinDataRelayPath(home, path.slice(2).replace(/^[\\/]+/, ""));
  } else if (!isAbsoluteDataRelayPath(path)) {
    const relative = path.replace(/^\.[\\/]/, "");
    path = joinDataRelayPath(home, relative);
  }

  return { listPath: stripDataRelayTrailingSep(path) || home };
}

function quotePosixShell(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

function quotePowerShellLiteral(path: string): string {
  return `'${path.replace(/'/g, "''")}'`;
}

export function buildDataRelayFollowCommand(
  sourcePath: string,
  options?: { os?: DataRelayFollowOs; writeMode?: DataRelayWriteMode },
): string {
  const path = sourcePath.trim();
  if (!path) return "";
  const appendOnly = options?.writeMode === "append";
  const directory = isDataRelayDirectoryHint(path);
  if (options?.os === "windows") {
    const tail = appendOnly ? " -Tail 0" : "";
    const target = directory ? joinDataRelayPath(path, "*") : path;
    const pathSwitch = directory ? "-Path" : "-LiteralPath";
    return `powershell -NoProfile -NonInteractive -Command "Get-Content ${pathSwitch} ${quotePowerShellLiteral(target)}${tail} -Wait"`;
  }
  const fromStart = appendOnly ? "-n 0" : "-n +1";
  if (directory) {
    return `tail ${fromStart} -F -- ${quotePosixShell(stripDataRelayTrailingSep(path))}/*`;
  }
  return `tail ${fromStart} -F -- ${quotePosixShell(path)}`;
}
