import {
  accountSftpDirectoryEntries,
  claimSftpDirectoryVisit,
  createSftpDirectoryTraversalBudget,
  releaseSftpDirectoryVisit,
} from "./sftpDirectoryCheckpoint";

export type DataRelayCompareFileType = "file" | "directory" | "symlink";

export interface DataRelayCompareFile {
  name: string;
  type: DataRelayCompareFileType;
  linkTarget?: "file" | "directory" | null;
  size: number;
  lastModified: number;
}

export interface DataRelayCompareEntry extends DataRelayCompareFile {
  relativePath: string;
}

export type DataRelayCompareKind =
  | "same"
  | "left-only"
  | "right-only"
  | "newer-left"
  | "newer-right"
  | "size-diff"
  | "type-diff"
  | "content-diff";

export interface DataRelayCompareRow {
  relativePath: string;
  name: string;
  kind: DataRelayCompareKind;
  left?: DataRelayCompareFile;
  right?: DataRelayCompareFile;
}

export interface DataRelayCompareSummary {
  same: number;
  leftOnly: number;
  rightOnly: number;
  different: number;
}

export type DataRelayCompareCopyDirection = "left-to-right" | "right-to-left";
export type DataRelayCompareSyncDirection = DataRelayCompareCopyDirection | "both";

export const DATA_RELAY_COMPARE_LISTING_CONCURRENCY = 8;

export type DataRelayCompareCopyItem =
  | { type: "file"; relativePath: string; file: DataRelayCompareFile }
  | { type: "directory"; relativePath: string };

export const DATA_RELAY_COMPARE_TIMESTAMP_TOLERANCE_MS = 2000;

export const isDataRelayCompareDirectory = (file: DataRelayCompareFile | undefined): boolean =>
  Boolean(file && (file.type === "directory" || file.linkTarget === "directory"));

const compareName = (a: string, b: string, caseInsensitive: boolean): number =>
  a.localeCompare(b, undefined, { sensitivity: caseInsensitive ? "accent" : "variant" });

export function joinDataRelayRelativePath(parent: string, name: string): string {
  if (!parent) return name;
  return `${parent.replace(/\\/g, "/")}/${name}`;
}

export function dataRelayComparePathKey(relativePath: string, caseInsensitive: boolean): string {
  return caseInsensitive ? relativePath.toLowerCase() : relativePath;
}

export function isSafeDataRelayCompareName(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (name.includes("\0") || name.includes("/") || name.includes("\\")) return false;
  return true;
}

function indexListing(
  files: readonly DataRelayCompareFile[],
  caseInsensitive: boolean,
): Map<string, DataRelayCompareFile> {
  const map = new Map<string, DataRelayCompareFile>();
  for (const file of files) {
    if (!isSafeDataRelayCompareName(file.name)) continue;
    const key = caseInsensitive ? file.name.toLowerCase() : file.name;
    if (!map.has(key)) map.set(key, file);
  }
  return map;
}

function indexEntries(
  entries: readonly DataRelayCompareEntry[],
  caseInsensitive: boolean,
): Map<string, DataRelayCompareEntry> {
  const map = new Map<string, DataRelayCompareEntry>();
  for (const entry of entries) {
    if (!entry.relativePath || !isSafeDataRelayCompareName(entry.name)) continue;
    const key = dataRelayComparePathKey(entry.relativePath, caseInsensitive);
    if (!map.has(key)) map.set(key, entry);
  }
  return map;
}

function classifyBoth(
  left: DataRelayCompareFile,
  right: DataRelayCompareFile,
  timestampToleranceMs: number,
): DataRelayCompareKind {
  const leftDir = isDataRelayCompareDirectory(left);
  const rightDir = isDataRelayCompareDirectory(right);
  if (leftDir !== rightDir) return "type-diff";
  if (leftDir && rightDir) return "same";
  if (left.size !== right.size) return "size-diff";
  const delta = left.lastModified - right.lastModified;
  if (Math.abs(delta) <= timestampToleranceMs) return "same";
  return delta > 0 ? "newer-left" : "newer-right";
}

function relativePathDepth(relativePath: string): number {
  return relativePath.split("/").filter(Boolean).length;
}

function sortCompareRows(
  rows: DataRelayCompareRow[],
  caseInsensitive: boolean,
): DataRelayCompareRow[] {
  rows.sort((a, b) => {
    const depthDelta = relativePathDepth(a.relativePath) - relativePathDepth(b.relativePath);
    if (depthDelta !== 0) return depthDelta;
    const aDir = isDataRelayCompareDirectory(a.left) || isDataRelayCompareDirectory(a.right);
    const bDir = isDataRelayCompareDirectory(b.left) || isDataRelayCompareDirectory(b.right);
    if (aDir !== bDir) return aDir ? -1 : 1;
    return compareName(a.relativePath, b.relativePath, caseInsensitive);
  });
  return rows;
}

export function summarizeDataRelayCompare(
  rows: readonly DataRelayCompareRow[],
): DataRelayCompareSummary {
  const summary: DataRelayCompareSummary = {
    same: 0,
    leftOnly: 0,
    rightOnly: 0,
    different: 0,
  };
  for (const row of rows) {
    if (row.kind === "content-diff") continue;
    if (row.kind === "same") summary.same += 1;
    else if (row.kind === "left-only") summary.leftOnly += 1;
    else if (row.kind === "right-only") summary.rightOnly += 1;
    else summary.different += 1;
  }
  return summary;
}

export function isDataRelayCompareDifferent(kind: DataRelayCompareKind): boolean {
  return kind !== "same";
}

export function firstDataRelayRelativeSegment(relativePath: string): string {
  const index = relativePath.indexOf("/");
  return index === -1 ? relativePath : relativePath.slice(0, index);
}

/**
 * O(n) fold of recursive diffs onto the current directory listing names.
 * Diffs-only row lists never contain "same", so a missing name is unchanged.
 */
export function dataRelayCompareKindByFirstSegment(
  rows: readonly DataRelayCompareRow[],
  options?: { caseInsensitive?: boolean },
): Map<string, DataRelayCompareKind> {
  const caseInsensitive = options?.caseInsensitive === true;
  const groups = new Map<string, {
    name: string;
    kinds: Set<DataRelayCompareKind>;
    exact?: DataRelayCompareRow;
  }>();

  for (const row of rows) {
    if (row.kind === "same" || row.kind === "content-diff") continue;
    const segment = firstDataRelayRelativeSegment(row.relativePath);
    const key = dataRelayComparePathKey(segment, caseInsensitive);
    let group = groups.get(key);
    if (!group) {
      group = { name: segment, kinds: new Set() };
      groups.set(key, group);
    }
    group.kinds.add(row.kind);
    if (dataRelayComparePathKey(row.relativePath, caseInsensitive) === key) {
      group.exact = row;
    }
  }

  const map = new Map<string, DataRelayCompareKind>();
  for (const group of groups.values()) {
    if (group.exact) {
      map.set(group.name, group.exact.kind);
      continue;
    }
    if (group.kinds.has("type-diff")) map.set(group.name, "type-diff");
    else map.set(group.name, "content-diff");
  }
  return map;
}

function pathIsUnderPrefix(
  relativePath: string,
  prefix: string,
  caseInsensitive: boolean,
): boolean {
  const pathKey = dataRelayComparePathKey(relativePath, caseInsensitive);
  const prefixKey = dataRelayComparePathKey(prefix, caseInsensitive);
  return pathKey === prefixKey || pathKey.startsWith(`${prefixKey}/`);
}

/**
 * After a recursive compare, color a name in the current directory by folding
 * every nested path that starts with that name.
 */
export function dataRelayCompareKindForCurrentName(
  rows: readonly DataRelayCompareRow[],
  name: string,
  options?: { caseInsensitive?: boolean },
): DataRelayCompareKind | undefined {
  const caseInsensitive = options?.caseInsensitive === true;
  const matching = rows.filter((row) => pathIsUnderPrefix(row.relativePath, name, caseInsensitive));
  if (matching.length === 0) return undefined;
  const exact = matching.find((row) => dataRelayComparePathKey(row.relativePath, caseInsensitive)
    === dataRelayComparePathKey(name, caseInsensitive));
  if (exact && !isDataRelayCompareDirectory(exact.left) && !isDataRelayCompareDirectory(exact.right)) {
    return exact.kind;
  }
  if (matching.every((row) => row.kind === "same")) return "same";
  if (matching.every((row) => row.kind === "left-only")) return "left-only";
  if (matching.every((row) => row.kind === "right-only")) return "right-only";
  if (matching.some((row) => row.kind === "type-diff")) return "type-diff";
  return "content-diff";
}

function rollupDirectoryContentKinds(
  rows: DataRelayCompareRow[],
  caseInsensitive: boolean,
): DataRelayCompareRow[] {
  const dirs = rows
    .filter((row) => isDataRelayCompareDirectory(row.left) || isDataRelayCompareDirectory(row.right))
    .sort((a, b) => relativePathDepth(b.relativePath) - relativePathDepth(a.relativePath));

  for (const dir of dirs) {
    if (
      dir.kind === "left-only"
      || dir.kind === "right-only"
      || dir.kind === "type-diff"
    ) {
      continue;
    }
    const prefixKey = `${dataRelayComparePathKey(dir.relativePath, caseInsensitive)}/`;
    const nestedDiffers = rows.some((row) => {
      const key = dataRelayComparePathKey(row.relativePath, caseInsensitive);
      return key.startsWith(prefixKey) && row.kind !== "same";
    });
    if (nestedDiffers) dir.kind = "content-diff";
  }
  return rows;
}

function compareKeyedEntries(
  leftEntries: readonly DataRelayCompareEntry[],
  rightEntries: readonly DataRelayCompareEntry[],
  options?: { caseInsensitive?: boolean; timestampToleranceMs?: number },
): DataRelayCompareRow[] {
  const caseInsensitive = options?.caseInsensitive === true;
  const timestampToleranceMs = options?.timestampToleranceMs ?? DATA_RELAY_COMPARE_TIMESTAMP_TOLERANCE_MS;
  const leftMap = indexEntries(leftEntries, caseInsensitive);
  const rightMap = indexEntries(rightEntries, caseInsensitive);
  const keys = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const rows: DataRelayCompareRow[] = [];

  for (const key of keys) {
    const left = leftMap.get(key);
    const right = rightMap.get(key);
    if (left && right) {
      rows.push({
        relativePath: left.relativePath,
        name: left.name,
        kind: classifyBoth(left, right, timestampToleranceMs),
        left,
        right,
      });
      continue;
    }
    if (left) {
      rows.push({
        relativePath: left.relativePath,
        name: left.name,
        kind: "left-only",
        left,
      });
      continue;
    }
    if (right) {
      rows.push({
        relativePath: right.relativePath,
        name: right.name,
        kind: "right-only",
        right,
      });
    }
  }

  return sortCompareRows(
    rollupDirectoryContentKinds(rows, caseInsensitive),
    caseInsensitive,
  );
}

/**
 * WinSCP-style compare of the current directory listing (not recursive).
 * Matching names compare size and mtime; timestamps within the FAT-style
 * tolerance count as equal.
 */
export function compareDataRelayDirectoryListings(
  leftFiles: readonly DataRelayCompareFile[],
  rightFiles: readonly DataRelayCompareFile[],
  options?: { caseInsensitive?: boolean; timestampToleranceMs?: number },
): DataRelayCompareRow[] {
  return compareKeyedEntries(
    leftFiles.map((file) => ({ ...file, relativePath: file.name })),
    rightFiles.map((file) => ({ ...file, relativePath: file.name })),
    options,
  );
}

/**
 * Recursive WinSCP-style compare of two already-walked directory trees.
 * Directory rows that exist on both sides become content-diff when any
 * descendant differs.
 */
export function compareDataRelayTrees(
  leftEntries: readonly DataRelayCompareEntry[],
  rightEntries: readonly DataRelayCompareEntry[],
  options?: { caseInsensitive?: boolean; timestampToleranceMs?: number },
): DataRelayCompareRow[] {
  return compareKeyedEntries(leftEntries, rightEntries, options);
}

export function shouldCopyDataRelayCompareRow(
  row: DataRelayCompareRow,
  direction: DataRelayCompareCopyDirection,
): boolean {
  const source = direction === "left-to-right" ? row.left : row.right;
  if (!source) return false;
  if (row.kind === "same") return false;
  if (direction === "left-to-right") {
    return row.kind !== "right-only" && row.kind !== "newer-right";
  }
  return row.kind !== "left-only" && row.kind !== "newer-left";
}

export function dataRelayCompareCopyDirectionForRow(
  row: DataRelayCompareRow,
  direction: DataRelayCompareSyncDirection,
): DataRelayCompareCopyDirection | null {
  if (row.kind === "same" || row.kind === "content-diff") return null;
  if (direction === "left-to-right") {
    return shouldCopyDataRelayCompareRow(row, "left-to-right") ? "left-to-right" : null;
  }
  if (direction === "right-to-left") {
    return shouldCopyDataRelayCompareRow(row, "right-to-left") ? "right-to-left" : null;
  }
  if (row.kind === "right-only" || row.kind === "newer-right") return "right-to-left";
  return shouldCopyDataRelayCompareRow(row, "left-to-right") ? "left-to-right" : null;
}

export function dataRelayCompareRowAppliesToDirection(
  row: DataRelayCompareRow,
  direction: DataRelayCompareSyncDirection,
): boolean {
  return dataRelayCompareCopyDirectionForRow(row, direction) !== null;
}

export function listDataRelayCompareCopyItems(
  rows: readonly DataRelayCompareRow[],
  direction: DataRelayCompareCopyDirection,
  selection?: {
    name?: string;
    copyAllUnderPrefix?: boolean;
    paths?: ReadonlySet<string>;
  } | null,
): DataRelayCompareCopyItem[] {
  const sourceOf = (row: DataRelayCompareRow) =>
    direction === "left-to-right" ? row.left : row.right;

  const scoped = selection?.name
    ? rows.filter((row) => pathIsUnderPrefix(row.relativePath, selection.name, false))
    : rows;

  const copyAll = Boolean(selection?.copyAllUnderPrefix);
  const paths = selection?.paths;
  const items: DataRelayCompareCopyItem[] = [];
  const seen = new Set<string>();

  const push = (item: DataRelayCompareCopyItem) => {
    if (seen.has(item.relativePath)) return;
    seen.add(item.relativePath);
    items.push(item);
  };

  for (const row of scoped) {
    const source = sourceOf(row);
    if (!source) continue;
    const include = paths
      ? paths.has(row.relativePath)
      : copyAll
        || (selection?.name && row.relativePath === selection.name)
        || (!selection?.name && shouldCopyDataRelayCompareRow(row, direction));
    if (!include) continue;
    if (isDataRelayCompareDirectory(source)) {
      if (copyAll || row.kind === "left-only" || row.kind === "right-only") {
        push({ type: "directory", relativePath: row.relativePath });
      }
      continue;
    }
    push({ type: "file", relativePath: row.relativePath, file: source });
  }

  items.sort((a, b) => {
    const depthDelta = relativePathDepth(a.relativePath) - relativePathDepth(b.relativePath);
    if (depthDelta !== 0) return depthDelta;
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.relativePath.localeCompare(b.relativePath);
  });
  return items;
}

export function parentDataRelayRelativePath(relativePath: string): string {
  const index = relativePath.lastIndexOf("/");
  return index <= 0 ? "" : relativePath.slice(0, index);
}

export interface DataRelayCompareTreeListError {
  path: string;
  message: string;
}

export interface DataRelayCompareTreeResult {
  entries: DataRelayCompareEntry[];
  errors: DataRelayCompareTreeListError[];
}

export interface CollectDataRelayCompareTreeOptions {
  joinAbsolute: (base: string, name: string) => string;
  cancelled?: () => boolean;
  concurrency?: number;
  maxDirectories?: number;
  maxEntries?: number;
}

async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

/**
 * Recursively list a directory tree. Directory symlinks are recorded but not
 * followed, matching WinSCP's default synchronize walk.
 */
export async function collectDataRelayCompareTree(
  rootPath: string,
  list: (absolutePath: string) => Promise<readonly DataRelayCompareFile[]>,
  options: CollectDataRelayCompareTreeOptions,
): Promise<DataRelayCompareTreeResult> {
  const budget = createSftpDirectoryTraversalBudget({
    maxDirectories: options.maxDirectories,
    maxEntries: options.maxEntries,
  });
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const entries: DataRelayCompareEntry[] = [];
  const errors: DataRelayCompareTreeListError[] = [];
  let level: Array<{ abs: string; rel: string }> = [{ abs: rootPath, rel: "" }];

  while (level.length > 0) {
    if (options.cancelled?.()) {
      return { entries, errors };
    }
    const listings = await runPool(level, concurrency, async (dir) => {
      const claimed = claimSftpDirectoryVisit(budget, dir.abs);
      if (!claimed) return { dir, files: [] as DataRelayCompareFile[] };
      try {
        const files = [...await list(dir.abs)];
        accountSftpDirectoryEntries(budget, files.length);
        return { dir, files };
      } catch (err) {
        errors.push({
          path: dir.abs,
          message: err instanceof Error ? err.message : String(err),
        });
        return { dir, files: [] as DataRelayCompareFile[] };
      } finally {
        releaseSftpDirectoryVisit(budget, claimed);
      }
    });

    const next: Array<{ abs: string; rel: string }> = [];
    for (const { dir, files } of listings) {
      for (const file of files) {
        if (!isSafeDataRelayCompareName(file.name)) continue;
        const relativePath = joinDataRelayRelativePath(dir.rel, file.name);
        entries.push({ ...file, relativePath });
        if (file.type === "directory") {
          next.push({
            abs: options.joinAbsolute(dir.abs, file.name),
            rel: relativePath,
          });
        }
      }
    }
    level = next;
  }

  return { entries, errors };
}

export interface DataRelayCompareProgress {
  scanned: number;
  diffs: number;
  same: number;
}

export interface DataRelayPairedCompareResult {
  diffs: DataRelayCompareRow[];
  summary: DataRelayCompareSummary;
  errors: DataRelayCompareTreeListError[];
}

export interface CompareDataRelayTreesPairedOptions {
  joinAbsolute: (base: string, name: string) => string;
  cancelled?: () => boolean;
  concurrency?: number;
  caseInsensitive?: boolean;
  timestampToleranceMs?: number;
  maxDirectories?: number;
  maxEntries?: number;
  onProgress?: (progress: DataRelayCompareProgress) => void;
}

type PairJob = { leftAbs: string; rightAbs: string; rel: string };
type SideOnlyJob = { side: "left" | "right"; abs: string; rel: string };

/**
 * WinSCP-style recursive compare: list matching directories in lockstep and
 * keep only differences. Identical files are counted, not stored, so large
 * mostly-similar trees stay cheap; unique subtrees are still walked once.
 */
export async function compareDataRelayTreesPaired(
  leftRoot: string,
  rightRoot: string,
  list: (side: "left" | "right", absolutePath: string) => Promise<readonly DataRelayCompareFile[]>,
  options: CompareDataRelayTreesPairedOptions,
): Promise<DataRelayPairedCompareResult> {
  const caseInsensitive = options.caseInsensitive === true;
  const timestampToleranceMs = options.timestampToleranceMs ?? DATA_RELAY_COMPARE_TIMESTAMP_TOLERANCE_MS;
  const concurrency = Math.max(1, options.concurrency ?? DATA_RELAY_COMPARE_LISTING_CONCURRENCY);
  const budget = createSftpDirectoryTraversalBudget({
    maxDirectories: options.maxDirectories,
    maxEntries: options.maxEntries,
  });
  const diffs: DataRelayCompareRow[] = [];
  const summary: DataRelayCompareSummary = { same: 0, leftOnly: 0, rightOnly: 0, different: 0 };
  const errors: DataRelayCompareTreeListError[] = [];
  let scanned = 0;
  let lastProgress = 0;

  const emitProgress = (force = false) => {
    if (!force && scanned - lastProgress < 250) return;
    lastProgress = scanned;
    options.onProgress?.({ scanned, diffs: diffs.length, same: summary.same });
  };

  const listSafe = async (side: "left" | "right", path: string): Promise<readonly DataRelayCompareFile[]> => {
    const claimed = claimSftpDirectoryVisit(budget, `${side}:${path}`);
    if (!claimed) return [];
    try {
      const files = await list(side, path);
      accountSftpDirectoryEntries(budget, files.length);
      scanned += files.length;
      return files;
    } catch (err) {
      errors.push({
        path,
        message: err instanceof Error ? err.message : String(err),
      });
      return [];
    } finally {
      releaseSftpDirectoryVisit(budget, claimed);
    }
  };

  const pushDiff = (row: DataRelayCompareRow) => {
    diffs.push(row);
    if (row.kind === "left-only") summary.leftOnly += 1;
    else if (row.kind === "right-only") summary.rightOnly += 1;
    else summary.different += 1;
  };

  let pairLevel: PairJob[] = [{ leftAbs: leftRoot, rightAbs: rightRoot, rel: "" }];
  const leftover: SideOnlyJob[] = [];

  while (pairLevel.length > 0) {
    if (options.cancelled?.()) {
      emitProgress(true);
      return { diffs, summary, errors };
    }
    const listings = await runPool(pairLevel, concurrency, async (job) => {
      const [leftFiles, rightFiles] = await Promise.all([
        listSafe("left", job.leftAbs),
        listSafe("right", job.rightAbs),
      ]);
      return { job, leftFiles, rightFiles };
    });
    emitProgress();

    const nextPairs: PairJob[] = [];
    for (const { job, leftFiles, rightFiles } of listings) {
      const leftMap = indexListing(leftFiles, caseInsensitive);
      const rightMap = indexListing(rightFiles, caseInsensitive);
      const keys = new Set([...leftMap.keys(), ...rightMap.keys()]);
      for (const key of keys) {
        const leftFile = leftMap.get(key);
        const rightFile = rightMap.get(key);
        if (leftFile && rightFile) {
          const relativePath = joinDataRelayRelativePath(job.rel, leftFile.name);
          const leftDir = isDataRelayCompareDirectory(leftFile);
          const rightDir = isDataRelayCompareDirectory(rightFile);
          if (leftDir && rightDir) {
            if (leftFile.type === "directory" && rightFile.type === "directory") {
              nextPairs.push({
                leftAbs: options.joinAbsolute(job.leftAbs, leftFile.name),
                rightAbs: options.joinAbsolute(job.rightAbs, rightFile.name),
                rel: relativePath,
              });
            }
            continue;
          }
          const kind = classifyBoth(leftFile, rightFile, timestampToleranceMs);
          if (kind === "same") {
            summary.same += 1;
            continue;
          }
          pushDiff({
            relativePath,
            name: leftFile.name,
            kind,
            left: leftFile,
            right: rightFile,
          });
          continue;
        }
        if (leftFile) {
          const relativePath = joinDataRelayRelativePath(job.rel, leftFile.name);
          pushDiff({ relativePath, name: leftFile.name, kind: "left-only", left: leftFile });
          if (leftFile.type === "directory") {
            leftover.push({
              side: "left",
              abs: options.joinAbsolute(job.leftAbs, leftFile.name),
              rel: relativePath,
            });
          }
          continue;
        }
        if (rightFile) {
          const relativePath = joinDataRelayRelativePath(job.rel, rightFile.name);
          pushDiff({ relativePath, name: rightFile.name, kind: "right-only", right: rightFile });
          if (rightFile.type === "directory") {
            leftover.push({
              side: "right",
              abs: options.joinAbsolute(job.rightAbs, rightFile.name),
              rel: relativePath,
            });
          }
        }
      }
    }
    pairLevel = nextPairs;
  }

  let sideLevel = leftover;
  while (sideLevel.length > 0) {
    if (options.cancelled?.()) break;
    const listings = await runPool(sideLevel, concurrency, async (job) => {
      const files = await listSafe(job.side, job.abs);
      return { job, files };
    });
    emitProgress();
    const nextSide: SideOnlyJob[] = [];
    for (const { job, files } of listings) {
      for (const file of files) {
        if (!isSafeDataRelayCompareName(file.name)) continue;
        const relativePath = joinDataRelayRelativePath(job.rel, file.name);
        if (job.side === "left") {
          pushDiff({ relativePath, name: file.name, kind: "left-only", left: file });
        } else {
          pushDiff({ relativePath, name: file.name, kind: "right-only", right: file });
        }
        if (file.type === "directory") {
          nextSide.push({
            side: job.side,
            abs: options.joinAbsolute(job.abs, file.name),
            rel: relativePath,
          });
        }
      }
    }
    sideLevel = nextSide;
  }

  diffs.sort((a, b) => compareName(a.relativePath, b.relativePath, caseInsensitive));
  emitProgress(true);
  return { diffs, summary, errors };
}

