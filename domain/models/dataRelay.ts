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
 * A data relay moves a live byte stream from one SSH host to a file on another
 * SSH host:
 *   source host: run `sourceCommand`, capture stdout
 *   destination host: append/overwrite `destPath` via SFTP
 * All forwarding happens in the Electron main process so the payload never
 * round-trips through the renderer.
 */
export interface DataRelayRule {
  id: string;
  label: string;
  order?: number;
  // Source: SSH host whose command output becomes the relayed stream.
  sourceHostId: string;
  sourceCommand: string;
  // Destination: SSH host that receives the streamed data.
  destHostId: string;
  destPath: string;
  writeMode: DataRelayWriteMode;
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
