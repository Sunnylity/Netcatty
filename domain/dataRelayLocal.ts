import type { Host } from "./models";

/**
 * Sentinel host id for the local machine in data-relay rules. A rule with the
 * sentinel on one end syncs the local filesystem against a remote SSH host;
 * both ends local is rejected (there is nothing to transfer).
 */
export const DATA_RELAY_LOCAL_HOST_ID = "local";

export const isDataRelayLocalHostId = (hostId: string | undefined | null): boolean =>
  String(hostId ?? "") === DATA_RELAY_LOCAL_HOST_ID;

/**
 * Build the pseudo Host used for the local endpoint. `label` is the display
 * name (localized by callers when available); the connection code branches on
 * isDataRelayLocalHostId instead of the pseudo host's fields.
 */
export const dataRelayLocalPseudoHost = (label = "Local"): Host => ({
  id: DATA_RELAY_LOCAL_HOST_ID,
  label,
  hostname: "localhost",
  username: "",
  tags: [],
  os: "linux",
});

export type DataRelayEndpoint = { host: Host; isLocal: boolean };

/**
 * Resolve a relay host id to a vault host or the local pseudo-host. Returns
 * null when the id matches no vault host (the local sentinel always resolves).
 */
export const resolveDataRelayEndpoint = (
  hostId: string | undefined,
  hosts: Host[],
  localLabel?: string,
): DataRelayEndpoint | null => {
  if (isDataRelayLocalHostId(hostId)) {
    return { host: dataRelayLocalPseudoHost(localLabel), isLocal: true };
  }
  const host = hosts.find((candidate) => candidate.id === hostId);
  return host ? { host, isLocal: false } : null;
};
