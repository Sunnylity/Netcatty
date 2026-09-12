// Data Relay (data forwarding) types
/**
 * Display / projection status for a data-relay rule.
 * `unknown` means the authoritative main-process snapshot could not be read;
 * it must never be persisted to localStorage.
 */
export type DataRelayStatus =
  | 'inactive'
  | 'connecting'
  | 'active'
  | 'error'
  | 'unknown';

/** How the relayed stream is written into the destination file. */
export type DataRelayWriteMode = 'overwrite' | 'append';

/**
 * How a folder relay decides which files to copy on each scan.
 * `mtime` compares source vs destination by size and add/modify time.
 * `checkpoint` remembers the last uploaded file set and only copies new/changed files.
 */
export type DataRelayScanMode = 'mtime' | 'checkpoint';

export interface DataRelayScanCheckpointFile {
  size: number;
  lastModified: number;
}

export interface DataRelayScanCheckpoint {
  at: number;
  files: Record<string, DataRelayScanCheckpointFile>;
}

/**
 * A data relay copies a live file stream from one SSH host to a path on another
 * SSH host:
 *   source host: follow files in `sourcePath`
 *   destination host: append/overwrite into `destPath` via SFTP
 * All forwarding happens in the Electron main process so the payload never
 * round-trips through the renderer.
 */
export interface DataRelayRule {
  id: string;
  label: string;
  order?: number;
  // Source: SSH host whose file becomes the relayed stream.
  sourceHostId: string;
  /** Remote folder followed on the source host. Optional on legacy saved rules. */
  sourcePath?: string;
  /**
   * Command executed on the source host to produce the byte stream.
   * Generated from `sourcePath` for new rules; kept for legacy command-based rules.
   */
  sourceCommand: string;
  // Destination: SSH host that receives the streamed data.
  destHostId: string;
  destPath: string;
  writeMode: DataRelayWriteMode;
  /** Milliseconds between folder scans. Default 30000. */
  scanIntervalMs?: number;
  /** How each scan chooses files to copy. Default `mtime`. */
  scanMode?: DataRelayScanMode;
  /** Last uploaded source snapshot used by `checkpoint` scan mode. */
  scanCheckpoint?: DataRelayScanCheckpoint;
  // Auto-start: if true, this rule will automatically start when the app launches
  autoStart?: boolean;
  /**
   * Runtime projection for the UI. Authoritative phase lives in the Electron
   * main-process registry; rebuilt from snapshots / events and never persisted.
   */
  status: DataRelayStatus;
  error?: string;
  /** Bytes forwarded during the current run (runtime projection only). */
  bytesTransferred?: number;
  createdAt: number;
  lastUsedAt?: number;
}
