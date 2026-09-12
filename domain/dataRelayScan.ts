import {
  DATA_RELAY_COMPARE_TIMESTAMP_TOLERANCE_MS,
  isDataRelayCompareDirectory,
  listDataRelayCompareCopyItems,
  parentDataRelayRelativePath,
  type DataRelayCompareCopyItem,
  type DataRelayCompareEntry,
  type DataRelayCompareRow,
} from "./dataRelayCompare";
import type {
  DataRelayRule,
  DataRelayScanCheckpoint,
  DataRelayScanCheckpointFile,
  DataRelayScanMode,
} from "./models/dataRelay";

export const DEFAULT_DATA_RELAY_SCAN_INTERVAL_MS = 30_000;
export const MIN_DATA_RELAY_SCAN_INTERVAL_MS = 5_000;
export const MAX_DATA_RELAY_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type DataRelayScanIntervalUnit = "seconds" | "minutes";

export function isDataRelayFolderScanRule(
  rule: Pick<DataRelayRule, "sourcePath">,
): boolean {
  return Boolean(rule.sourcePath?.trim());
}

export function normalizeDataRelayScanIntervalMs(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DATA_RELAY_SCAN_INTERVAL_MS;
  return Math.min(
    MAX_DATA_RELAY_SCAN_INTERVAL_MS,
    Math.max(MIN_DATA_RELAY_SCAN_INTERVAL_MS, Math.round(parsed)),
  );
}

export function normalizeDataRelayScanMode(value: unknown): DataRelayScanMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "checkpoint" || normalized === "watermark" || normalized === "upload") {
    return "checkpoint";
  }
  return "mtime";
}

/** First start (or mtime mode) compares source vs dest before copying. */
export function shouldCompareDataRelayScanAgainstDest(
  rule: Pick<DataRelayRule, "scanMode" | "scanCheckpoint">,
): boolean {
  if (normalizeDataRelayScanMode(rule.scanMode) === "mtime") return true;
  return !rule.scanCheckpoint?.at;
}

export function dataRelayScanIntervalParts(
  intervalMs: number | undefined,
): { value: number; unit: DataRelayScanIntervalUnit } {
  const normalized = normalizeDataRelayScanIntervalMs(intervalMs);
  if (normalized >= 60_000 && normalized % 60_000 === 0) {
    return { value: normalized / 60_000, unit: "minutes" };
  }
  return { value: Math.round(normalized / 1000), unit: "seconds" };
}

export function dataRelayScanIntervalFromParts(
  value: number,
  unit: DataRelayScanIntervalUnit,
): number {
  const amount = Number.isFinite(value) ? value : unit === "minutes" ? 1 : 30;
  return normalizeDataRelayScanIntervalMs(amount * (unit === "minutes" ? 60_000 : 1_000));
}

const sortCopyItems = (items: DataRelayCompareCopyItem[]): DataRelayCompareCopyItem[] =>
  [...items].sort((a, b) => {
    const aDepth = a.relativePath.split("/").length;
    const bDepth = b.relativePath.split("/").length;
    if (aDepth !== bDepth) return aDepth - bDepth;
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.relativePath.localeCompare(b.relativePath);
  });

export function isDataRelayCheckpointChanged(
  entry: DataRelayCompareEntry,
  previous: DataRelayScanCheckpointFile | undefined,
  timestampToleranceMs: number = DATA_RELAY_COMPARE_TIMESTAMP_TOLERANCE_MS,
): boolean {
  if (!previous) return true;
  if (isDataRelayCompareDirectory(entry)) return false;
  if (entry.size !== previous.size) return true;
  return Math.abs(entry.lastModified - previous.lastModified) > timestampToleranceMs;
}

export function listDataRelayScanCopyItemsFromMtime(
  diffs: readonly DataRelayCompareRow[],
): DataRelayCompareCopyItem[] {
  return listDataRelayCompareCopyItems(diffs, "left-to-right");
}

export function listDataRelayScanCopyItemsFromCheckpoint(
  sourceEntries: readonly DataRelayCompareEntry[],
  checkpoint: DataRelayScanCheckpoint | undefined,
  timestampToleranceMs: number = DATA_RELAY_COMPARE_TIMESTAMP_TOLERANCE_MS,
): DataRelayCompareCopyItem[] {
  const previous = checkpoint?.files ?? {};
  const items: DataRelayCompareCopyItem[] = [];
  const seen = new Set<string>();
  const push = (item: DataRelayCompareCopyItem) => {
    if (seen.has(item.relativePath)) return;
    seen.add(item.relativePath);
    items.push(item);
  };

  for (const entry of sourceEntries) {
    const prev = previous[entry.relativePath];
    if (isDataRelayCompareDirectory(entry)) {
      if (!prev) push({ type: "directory", relativePath: entry.relativePath });
      continue;
    }
    if (entry.type === "symlink" && entry.linkTarget !== "file") continue;
    if (!isDataRelayCheckpointChanged(entry, prev, timestampToleranceMs)) continue;
    const parent = parentDataRelayRelativePath(entry.relativePath);
    if (parent && !previous[parent]) {
      push({ type: "directory", relativePath: parent });
    }
    push({ type: "file", relativePath: entry.relativePath, file: entry });
  }

  return sortCopyItems(items);
}

export function mergeDataRelayScanCheckpoint(params: {
  previous?: DataRelayScanCheckpoint;
  sourceEntries: readonly DataRelayCompareEntry[];
  copiedPaths: ReadonlySet<string>;
  failedPaths: ReadonlySet<string>;
  now: number;
  pruneMissing?: boolean;
  seedAll?: boolean;
}): DataRelayScanCheckpoint {
  const files: Record<string, DataRelayScanCheckpointFile> = {
    ...(params.previous?.files ?? {}),
  };
  const seen = new Set<string>();
  for (const entry of params.sourceEntries) {
    seen.add(entry.relativePath);
    if (params.failedPaths.has(entry.relativePath)) continue;
    if (
      !params.seedAll
      && !params.copiedPaths.has(entry.relativePath)
      && !files[entry.relativePath]
    ) continue;
    files[entry.relativePath] = {
      size: isDataRelayCompareDirectory(entry) ? 0 : entry.size,
      lastModified: entry.lastModified,
    };
  }
  if (params.pruneMissing) {
    for (const path of Object.keys(files)) {
      if (!seen.has(path)) delete files[path];
    }
  }
  return { at: params.now, files };
}
