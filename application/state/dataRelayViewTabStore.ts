import { useSyncExternalStore } from "react";
import { activeTabStore } from "./activeTabStore";

export const DATA_RELAY_VIEW_TAB_PREFIX = "data-relay:";

export interface DataRelayViewTab {
  id: string;
  ruleId: string;
  label: string;
}

export function toDataRelayViewTabId(ruleId: string): string {
  return `${DATA_RELAY_VIEW_TAB_PREFIX}${ruleId}`;
}

export function isDataRelayViewTabId(tabId: string): boolean {
  return tabId.startsWith(DATA_RELAY_VIEW_TAB_PREFIX);
}

export function fromDataRelayViewTabId(tabId: string): string | null {
  if (!isDataRelayViewTabId(tabId)) return null;
  return tabId.slice(DATA_RELAY_VIEW_TAB_PREFIX.length) || null;
}

export class DataRelayViewTabStore {
  private tabs: readonly DataRelayViewTab[] = Object.freeze([]);
  private listeners = new Set<() => void>();

  constructor(
    private readonly activeTabs: Pick<typeof activeTabStore, "getActiveTabId" | "setActiveTabId"> = activeTabStore,
  ) {}

  getTabs = (): readonly DataRelayViewTab[] => this.tabs;

  getTab(tabId: string): DataRelayViewTab | undefined {
    return this.tabs.find((tab) => tab.id === tabId);
  }

  open(rule: { id: string; label: string }): DataRelayViewTab {
    const id = toDataRelayViewTabId(rule.id);
    const tab = Object.freeze({
      id,
      ruleId: rule.id,
      label: rule.label.trim() || rule.id,
    });
    const index = this.tabs.findIndex((candidate) => candidate.id === id);
    this.tabs = Object.freeze(
      index === -1
        ? [...this.tabs, tab]
        : this.tabs.map((candidate) => (candidate.id === id ? tab : candidate)),
    );
    this.emit();
    this.activeTabs.setActiveTabId(id);
    return tab;
  }

  close(tabId: string): void {
    if (!this.tabs.some((tab) => tab.id === tabId)) return;
    this.tabs = Object.freeze(this.tabs.filter((tab) => tab.id !== tabId));
    if (this.activeTabs.getActiveTabId() === tabId) {
      this.activeTabs.setActiveTabId("vault");
    }
    this.emit();
  }

  /** Drop tabs whose rules were deleted and refresh labels. */
  syncRules(rules: readonly { id: string; label: string }[]): void {
    const byId = new Map(rules.map((rule) => [rule.id, rule]));
    let changed = false;
    const next: DataRelayViewTab[] = [];
    for (const tab of this.tabs) {
      const rule = byId.get(tab.ruleId);
      if (!rule) {
        changed = true;
        continue;
      }
      const label = rule.label.trim() || rule.id;
      if (label === tab.label) {
        next.push(tab);
        continue;
      }
      changed = true;
      next.push(Object.freeze({ ...tab, label }));
    }
    if (!changed) return;
    const activeTabId = this.activeTabs.getActiveTabId();
    this.tabs = Object.freeze(next);
    if (isDataRelayViewTabId(activeTabId) && !next.some((tab) => tab.id === activeTabId)) {
      this.activeTabs.setActiveTabId("vault");
    }
    this.emit();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const dataRelayViewTabStore = new DataRelayViewTabStore();

export function useDataRelayViewTabs(): readonly DataRelayViewTab[] {
  return useSyncExternalStore(
    dataRelayViewTabStore.subscribe,
    dataRelayViewTabStore.getTabs,
    dataRelayViewTabStore.getTabs,
  );
}
