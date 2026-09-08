/**
 * Another tab wiping the vault is undone here; a proven removal is not.
 *
 * The case that actually bit: a tab still running the pre-fix bundle, dropping every new
 * bid on its 20-second poll for hours after the fix deployed. Nothing shipped can reach
 * that tab. What can be done is to notice the shrink, check whether anyone announced
 * proof for it, and put back what nobody did.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VAULT_CHANNEL, VAULT_KEY, allBids, identityOf, saveBid, type StoredBid } from "@/lib/vault";
import { _resetVaultSyncForTest, staleTabState, startVaultSync } from "@/lib/vaultSync";

/* jsdom has no BroadcastChannel; Node does, and instances in one process talk. */
if (typeof globalThis.BroadcastChannel === "undefined") {
  const { BroadcastChannel } = await import("node:worker_threads");
  (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = BroadcastChannel;
}

const bid = (level: number) => ({
  level, claimSecret: 11n, seed: 22n, claimCommitment: 1000n + BigInt(level), upAnchor: 44n, downAnchor: 55n,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Another tab writes `next` over `prev`: the store changes and this tab hears about it. */
const otherTabWrites = (prev: StoredBid[], next: StoredBid[]) => {
  window.localStorage.setItem(VAULT_KEY, JSON.stringify(next));
  window.dispatchEvent(new StorageEvent("storage", {
    key: VAULT_KEY, oldValue: JSON.stringify(prev), newValue: JSON.stringify(next),
  }));
};

let other: BroadcastChannel;
beforeEach(() => {
  window.localStorage.clear();
  _resetVaultSyncForTest("1700.this");
  other = new BroadcastChannel(VAULT_CHANNEL);
  (other as unknown as { unref?: () => void }).unref?.();
});
afterEach(() => { other.close(); _resetVaultSyncForTest(); });

describe("an unannounced shrink from another tab", () => {
  it("is restored, and counted", async () => {
    startVaultSync();
    saveBid(8n, bid(1), 0);
    saveBid(8n, bid(2), 1);
    const [a, b] = allBids();
    otherTabWrites([a!, b!], [a!]);          // the old bundle's dropBid, from another tab
    await sleep(450);
    expect(allBids().map((x) => x.level).sort()).toEqual([1, 2]);
    expect(staleTabState().restored).toBe(1);
  });

  it("a wipe to [] is restored in full", async () => {
    startVaultSync();
    saveBid(8n, bid(1), 0);
    saveBid(9n, bid(2), 0);
    const before = allBids();
    otherTabWrites(before, []);
    await sleep(450);
    expect(allBids()).toHaveLength(2);
    expect(staleTabState().restored).toBe(2);
  });
});

describe("a removal another tab announced with proof", () => {
  it("is left alone", async () => {
    startVaultSync();
    saveBid(8n, bid(1), 0);
    saveBid(8n, bid(2), 1);
    const [a, b] = allBids();
    other.postMessage({ type: "removed", ids: [identityOf(b!)], at: Date.now() });
    await sleep(50);
    otherTabWrites([a!, b!], [a!]);
    await sleep(450);
    expect(allBids().map((x) => x.level)).toEqual([1]);
    expect(staleTabState().restored).toBe(0);
  });
});

describe("version skew is named, in the right tab", () => {
  it("hearing an older build marks the other tab as old", async () => {
    startVaultSync();
    other.postMessage({ type: "hello", build: "1600.old" });
    await sleep(50);
    expect(staleTabState().olderTab).toBe("1600.old");
    expect(staleTabState().thisTabOld).toBe(false);
  });

  it("hearing a newer build marks this tab as the old one", async () => {
    startVaultSync();
    other.postMessage({ type: "hello", build: "1800.new" });
    await sleep(50);
    expect(staleTabState().thisTabOld).toBe(true);
  });

  it("answers a hello so the other tab can judge too", async () => {
    const heard: string[] = [];
    other.addEventListener("message", (e) => { const m = (e as MessageEvent).data; if (m?.type === "here") heard.push(m.build); });
    startVaultSync();
    other.postMessage({ type: "hello", build: "1600.old" });
    await sleep(50);
    expect(heard).toEqual(["1700.this"]);
  });
});
