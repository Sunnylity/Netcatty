import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Host,
  Identity,
  KnownHost,
  RemoteFile,
  SSHKey,
  TerminalSettings,
} from "../../../domain/models";
import {
  getDataRelayFileName,
  isDataRelayDirectoryHint,
  resolveDataRelayViewerStart,
} from "../../../domain/dataRelayPaths";
import { getParentPath, isSafeNewFolderName, joinPath } from "./utils";
import { buildSftpHostCredentials } from "./useSftpHostCredentials";
import { useSftpBackend } from "../useSftpBackend";

export type RemotePathBrowserEntry = Pick<RemoteFile, "name" | "type" | "linkTarget">;

export interface UseRemotePathBrowserParams {
  open: boolean;
  host: Host | undefined;
  hosts: Host[];
  keys: SSHKey[];
  identities: Identity[];
  knownHosts?: KnownHost[];
  terminalSettings?: Pick<
    TerminalSettings,
    "verifyHostKeys" | "keepaliveInterval" | "keepaliveCountMax"
  >;
  initialPath?: string;
}

const isDirectoryEntry = (entry: RemotePathBrowserEntry): boolean =>
  entry.type === "directory" || (entry.type === "symlink" && entry.linkTarget === "directory");

const compareEntries = (a: RemotePathBrowserEntry, b: RemotePathBrowserEntry): number => {
  const aDir = isDirectoryEntry(a);
  const bDir = isDirectoryEntry(b);
  if (aDir !== bDir) return aDir ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
};

export function resolveRemotePathBrowserStart(
  initialPath: string | undefined,
  homeDir: string,
  options?: { preferDirectory?: boolean },
): { startDir: string; requestedName: string } {
  const requested = initialPath?.trim() || "";
  if (!requested) return { startDir: homeDir, requestedName: "" };
  if (options?.preferDirectory || isDataRelayDirectoryHint(requested)) {
    return {
      startDir: requested.replace(/[\\/]+$/, "") || requested,
      requestedName: "",
    };
  }
  const requestedName = getDataRelayFileName(requested);
  const startDir = requestedName ? getParentPath(requested) : requested;
  return { startDir: startDir || homeDir, requestedName };
}

export function useRemotePathBrowser({
  open,
  host,
  hosts,
  keys,
  identities,
  knownHosts,
  terminalSettings,
  initialPath,
}: UseRemotePathBrowserParams) {
  const { openSftp, closeSftp, listSftp, getSftpHomeDir, mkdirSftp } = useSftpBackend();
  const [connecting, setConnecting] = useState(false);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState("/");
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<RemotePathBrowserEntry[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [sftpReady, setSftpReady] = useState(false);
  const sftpIdRef = useRef<string | null>(null);
  const currentPathRef = useRef("/");
  const listGenRef = useRef(0);
  const hostId = host?.id;
  const credentialsRef = useRef({ hosts, keys, identities, knownHosts, terminalSettings, host });
  credentialsRef.current = { hosts, keys, identities, knownHosts, terminalSettings, host };

  const releaseSftp = useCallback(async (sftpId: string | null) => {
    if (!sftpId) return;
    try {
      await closeSftp(sftpId);
    } catch {
      // Best-effort: the main process still owns session cleanup.
    }
  }, [closeSftp]);

  const listDirectory = useCallback(async (sftpId: string, path: string) => {
    const gen = ++listGenRef.current;
    setListing(true);
    setError(null);
    try {
      const raw = await listSftp(sftpId, path);
      if (gen !== listGenRef.current) return false;
      const next = (raw ?? [])
        .filter((entry) => entry.name && entry.name !== "." && entry.name !== "..")
        .map((entry) => ({
          name: entry.name,
          type: entry.type,
          linkTarget: entry.linkTarget,
        }))
        .filter(isDirectoryEntry)
        .sort(compareEntries);
      setEntries(next);
      setCurrentPath(path);
      return true;
    } catch (err) {
      if (gen !== listGenRef.current) return false;
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      if (gen === listGenRef.current) setListing(false);
    }
  }, [listSftp]);

  useEffect(() => {
    if (!open || !hostId) {
      setConnecting(false);
      setListing(false);
      setError(null);
      setEntries([]);
      setSelectedName(null);
      setSftpReady(false);
      return;
    }

    let cancelled = false;
    setConnecting(true);
    setSftpReady(false);
    setError(null);
    setEntries([]);
    setSelectedName(null);

    const connect = async () => {
      try {
        const current = credentialsRef.current;
        if (!current.host) throw new Error("Host is required.");
        const credentials = buildSftpHostCredentials({
          host: current.host,
          hosts: current.hosts,
          keys: current.keys,
          identities: current.identities,
          knownHosts: current.knownHosts,
          terminalSettings: current.terminalSettings,
        });
        const sftpId = await openSftp(credentials);
        sftpIdRef.current = sftpId;
        if (cancelled) {
          await releaseSftp(sftpId);
          sftpIdRef.current = null;
          return;
        }
        setSftpReady(true);

        const homeResult = await getSftpHomeDir(sftpId);
        const resolvedHome = homeResult?.homeDir?.trim() || "/";
        if (cancelled) return;
        setHomeDir(resolvedHome);
        const { listPath } = resolveDataRelayViewerStart(initialPath, resolvedHome);
        setCurrentPath(listPath);
        const listed = await listDirectory(sftpId, listPath);
        if (cancelled) return;
        if (!listed && listPath !== resolvedHome) {
          await listDirectory(sftpId, resolvedHome);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setConnecting(false);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      listGenRef.current += 1;
      const sftpId = sftpIdRef.current;
      sftpIdRef.current = null;
      void releaseSftp(sftpId);
    };
  }, [open, hostId, initialPath, openSftp, getSftpHomeDir, listDirectory, releaseSftp]);

  const navigateTo = useCallback(async (path: string) => {
    const sftpId = sftpIdRef.current;
    if (!sftpId) return;
    setSelectedName(null);
    await listDirectory(sftpId, path);
  }, [listDirectory]);

  currentPathRef.current = currentPath;

  const createFolder = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!isSafeNewFolderName(trimmed)) {
      throw new Error("Invalid folder name");
    }
    const sftpId = sftpIdRef.current;
    if (!sftpId) {
      throw new Error("SFTP session not ready");
    }
    const parentPath = currentPathRef.current;
    await mkdirSftp(sftpId, joinPath(parentPath, trimmed));
    await listDirectory(sftpId, parentPath);
    setSelectedName(trimmed);
  }, [listDirectory, mkdirSftp]);

  return {
    connecting,
    listing,
    error,
    homeDir,
    currentPath,
    entries,
    selectedName,
    setSelectedName,
    sftpReady,
    navigateTo,
    createFolder,
  };
}
