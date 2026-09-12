import { useCallback } from "react";
import { netcattyBridge } from "../../infrastructure/services/netcattyBridge";

/**
 * Native OS folder picker for local-endpoint path selection. `available`
 * reports whether the bridge exposes the dialog; `pickDirectory` resolves
 * with the chosen folder or null when the user cancels.
 */
export function useLocalDirectoryPicker(): {
  available: boolean;
  pickDirectory: (title?: string, defaultPath?: string) => Promise<string | null>;
} {
  const available = Boolean(netcattyBridge.get()?.selectDirectory);
  const pickDirectory = useCallback(async (title?: string, defaultPath?: string): Promise<string | null> => {
    const bridge = netcattyBridge.get();
    if (!bridge?.selectDirectory) return null;
    return bridge.selectDirectory(title, defaultPath);
  }, []);
  return { available, pickDirectory };
}
