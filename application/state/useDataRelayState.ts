import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DataRelayRule,
  DataRelayScanCheckpoint,
  Host,
  Identity,
  KnownHost,
  SSHKey,
  TerminalSettings,
} from "../../domain/models";
import {
  createDataRelayRule,
  duplicateDataRelayRule,
  updateDataRelayRule,
} from "../../domain/dataRelayAgentOps";
import { isDataRelayFolderScanRule } from "../../domain/dataRelayScan";
import { isDataRelayLocalHostId } from "../../domain/dataRelayLocal";
import {
  migrateDataRelayRulesFromStorage,
  toPersistedDataRelayRules,
} from "../../domain/dataRelayPersistence";
import {
  STORAGE_KEY_DATA_RELAY,
  STORAGE_KEY_DATA_RELAY_VIEW_MODE,
} from "../../infrastructure/config/storageKeys";
import { localStorageAdapter } from "../../infrastructure/persistence/localStorageAdapter";
import {
  fetchDataRelaySnapshot,
  startDataRelay,
  stopAllActiveDataRelays,
  stopDataRelay,
  subscribeDataRelayRuntime,
} from "../../infrastructure/services/dataRelayService";
import { useDataRelayFolderScan } from "./useDataRelayFolderScan";

export type DataRelayViewMode = "grid" | "list";

export interface UseDataRelayStateOptions {
  hosts: Host[];
  keys: SSHKey[];
  identities: Identity[];
  knownHosts?: KnownHost[];
  terminalSettings?: Pick<
    TerminalSettings,
    "verifyHostKeys" | "keepaliveInterval" | "keepaliveCountMax"
  >;
}

export interface DataRelayRuleMutationResult {
  ok: boolean;
  error?: string;
  rule?: DataRelayRule;
}

export interface UseDataRelayStateResult {
  rules: DataRelayRule[];
  viewMode: DataRelayViewMode;
  setViewMode: (mode: DataRelayViewMode) => void;
  createRule: (source: Record<string, unknown>) => DataRelayRuleMutationResult;
  updateRule: (ruleId: string, source: Record<string, unknown>, options?: { preserveRuntime?: boolean }) => DataRelayRuleMutationResult;
  duplicateRule: (ruleId: string) => DataRelayRuleMutationResult;
  deleteRule: (ruleId: string) => void;
  startRule: (ruleId: string) => Promise<{ success: boolean; error?: string }>;
  stopRule: (ruleId: string) => Promise<{ success: boolean; error?: string }>;
  startAllRules: () => Promise<void>;
  stopAllRules: () => Promise<void>;
}

const generateRuleId = (): string => {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `relay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const readStoredRules = (): DataRelayRule[] => {
  const stored = localStorageAdapter.read<DataRelayRule[]>(STORAGE_KEY_DATA_RELAY);
  if (!stored || !Array.isArray(stored)) return [];
  return migrateDataRelayRulesFromStorage(stored);
};

/**
 * Owns data relay rule configuration (persisted) plus the runtime projection
 * (status / bytes) fed by main-process snapshots and events.
 */
export const useDataRelayState = ({
  hosts,
  keys,
  identities,
  knownHosts,
  terminalSettings,
}: UseDataRelayStateOptions): UseDataRelayStateResult => {
  const [rules, setRules] = useState<DataRelayRule[]>(() => readStoredRules());
  const [viewMode, setViewModeState] = useState<DataRelayViewMode>(() =>
    localStorageAdapter.readString(STORAGE_KEY_DATA_RELAY_VIEW_MODE) === "list" ? "list" : "grid",
  );

  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const identitiesRef = useRef(identities);
  identitiesRef.current = identities;
  const knownHostsRef = useRef(knownHosts);
  knownHostsRef.current = knownHosts;
  const terminalSettingsRef = useRef(terminalSettings);
  terminalSettingsRef.current = terminalSettings;

  const setViewMode = useCallback((mode: DataRelayViewMode) => {
    setViewModeState(mode);
    localStorageAdapter.writeString(STORAGE_KEY_DATA_RELAY_VIEW_MODE, mode);
  }, []);

  /** Persist configuration only; runtime phases are never durable. */
  const commitRules = useCallback((next: DataRelayRule[]) => {
    rulesRef.current = next;
    setRules(next);
    localStorageAdapter.write(STORAGE_KEY_DATA_RELAY, toPersistedDataRelayRules(next));
  }, []);

  const patchRuleRuntime = useCallback(
    (ruleId: string, patch: Partial<Pick<DataRelayRule, "status" | "error" | "bytesTransferred" | "lastUsedAt">>) => {
      setRules((current) =>
        current.map((rule) =>
          rule.id === ruleId
            ? {
                ...rule,
                ...patch,
                ...(patch.error === undefined && "status" in patch && patch.status === "active"
                  ? { error: undefined }
                  : {}),
              }
            : rule,
        ),
      );
    },
    [],
  );

  const persistScanCheckpoint = useCallback((ruleId: string, checkpoint: DataRelayScanCheckpoint) => {
    setRules((current) => {
      if (!current.some((rule) => rule.id === ruleId)) return current;
      const next = current.map((rule) => (
        rule.id === ruleId
          ? { ...rule, scanCheckpoint: checkpoint, lastUsedAt: Date.now() }
          : rule
      ));
      localStorageAdapter.write(STORAGE_KEY_DATA_RELAY, toPersistedDataRelayRules(next));
      return next;
    });
  }, []);

  const {
    startScan,
    stopScan,
    stopAllScans,
    isScanning,
  } = useDataRelayFolderScan({
    getRule: (ruleId) => rulesRef.current.find((rule) => rule.id === ruleId),
    hosts,
    keys,
    identities,
    knownHosts,
    terminalSettings,
    onStatus: (ruleId, status, error) => patchRuleRuntime(ruleId, {
      status,
      error,
      ...(status === "active" || status === "error" ? { lastUsedAt: Date.now() } : {}),
    }),
    onBytes: (ruleId, bytesTransferred) => patchRuleRuntime(ruleId, { bytesTransferred }),
    onCheckpoint: persistScanCheckpoint,
  });
  const startScanRef = useRef(startScan);
  startScanRef.current = startScan;
  const stopScanRef = useRef(stopScan);
  stopScanRef.current = stopScan;
  const stopAllScansRef = useRef(stopAllScans);
  stopAllScansRef.current = stopAllScans;
  const isScanningRef = useRef(isScanning);
  isScanningRef.current = isScanning;

  // Runtime projection: apply the authoritative snapshot, then follow events.
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    const applyRecord = (record: DataRelayRuntimeRecord | undefined | null) => {
      if (!record?.ruleId) return;
      if (isScanningRef.current(record.ruleId)) return;
      const phase = record.phase;
      const status: DataRelayRule["status"] =
        phase === "connecting" || phase === "active" || phase === "error"
          ? phase
          : "inactive";
      patchRuleRuntime(record.ruleId, {
        status,
        error: status === "error" ? record.error : undefined,
        bytesTransferred: record.bytesTransferred,
      });
    };

    void (async () => {
      try {
        const snapshot = await fetchDataRelaySnapshot();
        if (disposed) return;
        for (const record of snapshot.records ?? []) {
          applyRecord(record);
        }
        unsubscribe = await subscribeDataRelayRuntime((event) => {
          if (disposed) return;
          if (event.kind === "upsert") {
            applyRecord(event.record);
            return;
          }
          if (event.kind === "remove" && event.ruleId) {
            if (isScanningRef.current(event.ruleId)) return;
            patchRuleRuntime(event.ruleId, { status: "inactive", error: undefined });
          }
        });
      } catch {
        // Runtime projection is best-effort; configuration still works offline.
      }
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [patchRuleRuntime]);

  const startRule = useCallback(
    async (ruleId: string): Promise<{ success: boolean; error?: string }> => {
      const rule = rulesRef.current.find((candidate) => candidate.id === ruleId);
      if (!rule) return { success: false, error: `Rule "${ruleId}" was not found.` };
      if (isDataRelayFolderScanRule(rule)) {
        if (isScanningRef.current(ruleId)) return { success: true };
        await stopDataRelay(ruleId);
        return startScanRef.current(ruleId);
      }
      // Command-driven relays stream a remote shell command over exec; the
      // local endpoint only exists for folder-scan sync rules.
      if (isDataRelayLocalHostId(rule.sourceHostId) || isDataRelayLocalHostId(rule.destHostId)) {
        return {
          success: false,
          error: "Local endpoints require a folder rule. Set a source folder path.",
        };
      }
      await stopScanRef.current(ruleId);
      return startDataRelay(
        rule,
        hostsRef.current,
        keysRef.current,
        identitiesRef.current,
        (status, error) => patchRuleRuntime(ruleId, { status, error }),
        terminalSettingsRef.current,
        knownHostsRef.current,
      );
    },
    [patchRuleRuntime],
  );

  const stopRule = useCallback(
    async (ruleId: string): Promise<{ success: boolean; error?: string }> => {
      await stopScanRef.current(ruleId);
      return stopDataRelay(ruleId, (status, error) => patchRuleRuntime(ruleId, { status, error }));
    },
    [patchRuleRuntime],
  );

  const startRuleRef = useRef(startRule);
  startRuleRef.current = startRule;
  const stopRuleRef = useRef(stopRule);
  stopRuleRef.current = stopRule;

  const createRule = useCallback(
    (source: Record<string, unknown>): DataRelayRuleMutationResult => {
      const result = createDataRelayRule(rulesRef.current, hostsRef.current, source, {
        id: generateRuleId(),
        now: Date.now(),
      });
      if ('error' in result) return { ok: false, error: result.error };
      commitRules(result.value.rules);
      return { ok: true, rule: result.value.rule };
    },
    [commitRules],
  );

  const updateRule = useCallback(
    (ruleId: string, source: Record<string, unknown>, options?: { preserveRuntime?: boolean }): DataRelayRuleMutationResult => {
      const existing = rulesRef.current.find((rule) => rule.id === ruleId);
      if (!existing) return { ok: false, error: `Rule "${ruleId}" was not found.` };
      const result = updateDataRelayRule(rulesRef.current, hostsRef.current, ruleId, source, options);
      if ('error' in result) return { ok: false, error: result.error };
      const connectionChanged =
        !options?.preserveRuntime
        && result.value.rule.status === "inactive"
        && (existing.status === "active" || existing.status === "connecting");
      if (connectionChanged) {
        void stopRuleRef.current(ruleId);
      }
      commitRules(result.value.rules);
      return { ok: true, rule: result.value.rule };
    },
    [commitRules],
  );

  const duplicateRule = useCallback(
    (ruleId: string): DataRelayRuleMutationResult => {
      const result = duplicateDataRelayRule(rulesRef.current, hostsRef.current, ruleId, {
        id: generateRuleId(),
        now: Date.now(),
      });
      if ('error' in result) return { ok: false, error: result.error };
      commitRules(result.value.rules);
      return { ok: true, rule: result.value.rule };
    },
    [commitRules],
  );

  const deleteRule = useCallback(
    (ruleId: string) => {
      void stopRuleRef.current(ruleId);
      commitRules(rulesRef.current.filter((rule) => rule.id !== ruleId));
    },
    [commitRules],
  );

  const startAllRules = useCallback(async () => {
    const targets = rulesRef.current.filter(
      (rule) => rule.status === "inactive" || rule.status === "error",
    );
    for (const rule of targets) {
      // Sequential so a bad credential does not fan out MFA prompts at once.
      await startRuleRef.current(rule.id);
    }
  }, []);

  const stopAllRules = useCallback(async () => {
    await stopAllScansRef.current();
    await stopAllActiveDataRelays();
    setRules((current) =>
      current.map((rule) =>
        rule.status === "active" || rule.status === "connecting"
          ? { ...rule, status: "inactive" as const, error: undefined }
          : rule,
      ),
    );
  }, []);

  // Auto-start rules once, after the first non-empty host list is available.
  const autoStartDoneRef = useRef(false);
  useEffect(() => {
    if (autoStartDoneRef.current) return;
    if (rules.length === 0 || hosts.length === 0) return;
    autoStartDoneRef.current = true;
    const autoRules = rules.filter((rule) => rule.autoStart);
    if (autoRules.length === 0) return;
    void (async () => {
      for (const rule of autoRules) {
        await startRuleRef.current(rule.id);
      }
    })();
  }, [rules, hosts]);

  return useMemo(
    () => ({
      rules,
      viewMode,
      setViewMode,
      createRule,
      updateRule,
      duplicateRule,
      deleteRule,
      startRule,
      stopRule,
      startAllRules,
      stopAllRules,
    }),
    [
      rules,
      viewMode,
      setViewMode,
      createRule,
      updateRule,
      duplicateRule,
      deleteRule,
      startRule,
      stopRule,
      startAllRules,
      stopAllRules,
    ],
  );
};
