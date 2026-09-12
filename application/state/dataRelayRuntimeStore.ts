import { useLayoutEffect, useSyncExternalStore } from "react";
import type { UseDataRelayStateResult } from "./useDataRelayState";

class DataRelayRuntimeStore {
  private snapshot: UseDataRelayStateResult | null = null;
  private listeners = new Set<() => void>();

  getSnapshot = (): UseDataRelayStateResult | null => this.snapshot;

  set(next: UseDataRelayStateResult | null): void {
    if (this.snapshot === next) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export const dataRelayRuntimeStore = new DataRelayRuntimeStore();

export function useDataRelayRuntime(): UseDataRelayStateResult | null {
  return useSyncExternalStore(
    dataRelayRuntimeStore.subscribe,
    dataRelayRuntimeStore.getSnapshot,
    dataRelayRuntimeStore.getSnapshot,
  );
}

/** Publish the vault-owned relay runtime so work tabs share one scan loop. */
export function usePublishDataRelayRuntime(state: UseDataRelayStateResult): void {
  useLayoutEffect(() => {
    dataRelayRuntimeStore.set(state);
    return () => {
      dataRelayRuntimeStore.set(null);
    };
  }, [state]);
}
