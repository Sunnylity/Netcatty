import { useSyncExternalStore } from "react";

export interface DataRelayPathClipboardEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  lastModified?: number;
}

export interface DataRelayPathClipboard {
  files: DataRelayPathClipboardEntry[];
  sourcePath: string;
  sourceHostId: string;
}

let clipboard: DataRelayPathClipboard | null = null;
const listeners = new Set<() => void>();

export function getDataRelayPathClipboard(): DataRelayPathClipboard | null {
  return clipboard;
}

export function setDataRelayPathClipboard(next: DataRelayPathClipboard | null): void {
  clipboard = next;
  listeners.forEach((listener) => listener());
}

export function subscribeDataRelayPathClipboard(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDataRelayPathClipboard(): DataRelayPathClipboard | null {
  return useSyncExternalStore(
    subscribeDataRelayPathClipboard,
    getDataRelayPathClipboard,
    getDataRelayPathClipboard,
  );
}
