import {
  collectDataRelayCompareTree,
  isSafeDataRelayCompareName,
  type DataRelayCompareFile,
} from "../../../domain/dataRelayCompare";
import type { DataRelayPathClipboardEntry } from "./dataRelayPathClipboardStore";
import { isSameSftpPath, isSftpDescendantPath, joinPath, joinTransferTargetPath } from "./utils";

export interface CopyRemotePathTransferOptions {
  transferId: string;
  sourcePath: string;
  targetPath: string;
  sourceType: "sftp";
  targetType: "sftp";
  sourceSftpId: string;
  targetSftpId: string;
  sourceHostId: string;
  targetHostId: string;
  totalBytes?: number;
  sourceLastModified?: number;
}

export interface CopyRemotePathEntriesParams {
  sourceSftpId: string;
  destSftpId: string;
  sourceHostId: string;
  destHostId: string;
  sourcePath: string;
  destPath: string;
  entries: readonly DataRelayPathClipboardEntry[];
  list: (sftpId: string, path: string) => Promise<readonly DataRelayCompareFile[]>;
  mkdir: (sftpId: string, path: string) => Promise<void>;
  transfer: (options: CopyRemotePathTransferOptions) => Promise<{ error?: string } | void>;
}

export interface CopyRemotePathEntriesResult {
  copied: string[];
  failed: string[];
  skipped: string[];
}

export function shouldSkipRemotePaste(params: {
  sourceHostId: string;
  destHostId: string;
  sourcePath: string;
  destPath: string;
  entryName: string;
}): boolean {
  if (params.sourceHostId !== params.destHostId) return false;
  const sourceAbs = joinPath(params.sourcePath, params.entryName);
  const destAbs = joinPath(params.destPath, params.entryName);
  if (isSameSftpPath(sourceAbs, destAbs)) return true;
  return isSftpDescendantPath(params.destPath, sourceAbs);
}

export function resolveOpenTerminalPath(
  currentPath: string,
  entry?: { name: string; isDirectory: boolean } | null,
): string {
  if (entry?.isDirectory && entry.name) return joinPath(currentPath, entry.name);
  return currentPath;
}

const mkdirQuiet = async (
  mkdir: CopyRemotePathEntriesParams["mkdir"],
  sftpId: string,
  path: string,
): Promise<void> => {
  try {
    await mkdir(sftpId, path);
  } catch {
    // Destination directory may already exist.
  }
};

export async function copyRemotePathEntries(
  params: CopyRemotePathEntriesParams,
): Promise<CopyRemotePathEntriesResult> {
  const copied: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  for (const entry of params.entries) {
    if (!isSafeDataRelayCompareName(entry.name)) {
      failed.push(entry.name);
      continue;
    }
    if (shouldSkipRemotePaste({
      sourceHostId: params.sourceHostId,
      destHostId: params.destHostId,
      sourcePath: params.sourcePath,
      destPath: params.destPath,
      entryName: entry.name,
    })) {
      skipped.push(entry.name);
      continue;
    }

    try {
      if (entry.isDirectory) {
        const sourceRoot = joinPath(params.sourcePath, entry.name);
        const destRoot = joinTransferTargetPath(params.destPath, entry.name);
        await mkdirQuiet(params.mkdir, params.destSftpId, destRoot);
        const tree = await collectDataRelayCompareTree(
          sourceRoot,
          (path) => params.list(params.sourceSftpId, path),
          { joinAbsolute: joinPath },
        );
        for (const error of tree.errors) {
          failed.push(error.path);
        }
        for (const item of tree.entries) {
          if (item.type === "directory") {
            await mkdirQuiet(
              params.mkdir,
              params.destSftpId,
              joinTransferTargetPath(destRoot, item.relativePath),
            );
            copied.push(`${entry.name}/${item.relativePath}`);
            continue;
          }
          if (item.linkTarget === "directory") continue;
          const result = await params.transfer({
            transferId: `relay-path-${Date.now()}-${entry.name}-${item.relativePath}`,
            sourcePath: joinTransferTargetPath(sourceRoot, item.relativePath),
            targetPath: joinTransferTargetPath(destRoot, item.relativePath),
            sourceType: "sftp",
            targetType: "sftp",
            sourceSftpId: params.sourceSftpId,
            targetSftpId: params.destSftpId,
            sourceHostId: params.sourceHostId,
            targetHostId: params.destHostId,
            totalBytes: item.size,
            sourceLastModified: item.lastModified,
          });
          if (result?.error) {
            failed.push(`${entry.name}/${item.relativePath}`);
            continue;
          }
          copied.push(`${entry.name}/${item.relativePath}`);
        }
        copied.push(entry.name);
        continue;
      }

      const result = await params.transfer({
        transferId: `relay-path-${Date.now()}-${entry.name}`,
        sourcePath: joinPath(params.sourcePath, entry.name),
        targetPath: joinPath(params.destPath, entry.name),
        sourceType: "sftp",
        targetType: "sftp",
        sourceSftpId: params.sourceSftpId,
        targetSftpId: params.destSftpId,
        sourceHostId: params.sourceHostId,
        targetHostId: params.destHostId,
        totalBytes: entry.size,
        sourceLastModified: entry.lastModified,
      });
      if (result?.error) {
        failed.push(entry.name);
        continue;
      }
      copied.push(entry.name);
    } catch (err) {
      failed.push(err instanceof Error ? `${entry.name}: ${err.message}` : entry.name);
    }
  }

  return { copied, failed, skipped };
}
