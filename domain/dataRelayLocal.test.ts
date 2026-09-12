import assert from "node:assert/strict";
import test from "node:test";

import type { Host } from "./models";
import {
  DATA_RELAY_LOCAL_HOST_ID,
  dataRelayLocalPseudoHost,
  isDataRelayLocalHostId,
  resolveDataRelayEndpoint,
} from "./dataRelayLocal";

const host = (id: string): Host => ({
  id,
  label: id,
  hostname: `${id}.local`,
  username: "root",
  tags: [],
  os: "linux",
});

const hosts = [host("win"), host("linux")];

test("isDataRelayLocalHostId matches only the sentinel", () => {
  assert.equal(isDataRelayLocalHostId(DATA_RELAY_LOCAL_HOST_ID), true);
  assert.equal(isDataRelayLocalHostId("local"), true);
  assert.equal(isDataRelayLocalHostId("win"), false);
  assert.equal(isDataRelayLocalHostId(undefined), false);
  assert.equal(isDataRelayLocalHostId(null), false);
});

test("resolveDataRelayEndpoint resolves vault hosts and the local pseudo-host", () => {
  const remote = resolveDataRelayEndpoint("win", hosts);
  assert.deepEqual(remote && { id: remote.host.id, isLocal: remote.isLocal }, { id: "win", isLocal: false });

  const local = resolveDataRelayEndpoint("local", hosts, "本机");
  assert.equal(local?.isLocal, true);
  assert.equal(local?.host.id, DATA_RELAY_LOCAL_HOST_ID);
  assert.equal(local?.host.label, "本机");

  assert.equal(resolveDataRelayEndpoint("missing", hosts), null);
});

test("dataRelayLocalPseudoHost defaults to a stable display label", () => {
  const pseudo = dataRelayLocalPseudoHost();
  assert.equal(pseudo.id, DATA_RELAY_LOCAL_HOST_ID);
  assert.equal(pseudo.label, "Local");
});
