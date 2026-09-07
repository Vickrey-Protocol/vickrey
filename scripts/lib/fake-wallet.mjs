/**
 * A wallet for the camera. Injected before a page loads, it announces itself the way an
 * extension does (a `starknet_*` key the discovery store scans) and answers the three
 * requests a connect needs — accounts, chain, supported API — so the dashboard renders
 * its connected state in headless Chrome, where no extension can exist. Every read the
 * dashboard then makes goes to the RPC, not to this object; it signs nothing and any
 * transaction request fails loudly.
 *
 *   SHOT_WALLET=0x…  /  AUDIT_WALLET=0x…   — the address it reports
 */
export const FAKE_WALLET = (address, chainId) => {
  const icon = "data:image/svg+xml;utf8," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect width='32' height='32' rx='8' fill='#0a0a0a'/><circle cx='16' cy='16' r='7' fill='#F2913F'/></svg>");
  window.starknet_camera = {
    id: "camera", name: "Camera", version: "1.0.0", icon,
    request: async ({ type }) => {
      switch (type) {
        case "wallet_requestAccounts": return [address];
        case "wallet_requestChainId": return chainId;
        case "wallet_supportedWalletApi": return ["0.10.3"];
        case "wallet_supportedSpecs": return ["0.8.1"];
        case "wallet_getPermissions": return ["accounts"];
        default: throw new Error(`camera wallet: ${type} is not supported`);
      }
    },
    on() {}, off() {},
  };
};
export const SEPOLIA = "0x534e5f5345504f4c4941";
