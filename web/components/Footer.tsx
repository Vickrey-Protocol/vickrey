import { config, explorerContract } from "@/lib/config";

const REPO = "https://github.com/Vickrey-Protocol/vickrey";

/** Contract rows only render when the address is actually configured. */
function ContractLink({ label, address }: { label: string; address: string }) {
  if (!address) return <li className="muted">{label} — not deployed</li>;
  return (
    <li>
      <a href={explorerContract(address)} target="_blank" rel="noreferrer">
        {label} <span className="mono">{address.slice(0, 8)}…{address.slice(-4)}</span>
      </a>
    </li>
  );
}

export function Footer() {
  return (
    <footer>
      <div className="foot-grid" data-reveal>
        <div className="foot-brand">
          <div className="wordmark">Vickrey<span aria-hidden="true" /></div>
          <p className="note" style={{ marginTop: ".6rem", maxWidth: "26ch" }}>
            Sealed-bid auctions on STRK20. The losing bids are never published, and the
            outcome is proved on-chain rather than asserted.
          </p>
          <span className="badge" style={{ marginTop: ".9rem", display: "inline-block" }}>
            {config.label}
          </span>
        </div>

        <div>
          <h4>Product</h4>
          <ul>
            <li><a href="#auctions">Auctions</a></li>
            <li><a href="#how">How it works</a></li>
            <li><a href="#faq">FAQ</a></li>
          </ul>
        </div>

        <div>
          <h4>Contracts</h4>
          <ul>
            <ContractLink label="Auction" address={config.auctionAddress} />
            <ContractLink label="Anonymizer" address={config.anonymizerAddress} />
            <ContractLink label="STRK20 pool" address={config.poolAddress} />
          </ul>
        </div>

        <div>
          <h4>Resources</h4>
          <ul>
            <li><a href={REPO} target="_blank" rel="noreferrer">Source on GitHub</a></li>
            <li><a href={`${REPO}#readme`} target="_blank" rel="noreferrer">Documentation</a></li>
            <li><a href={`${REPO}/blob/main/TRUST.md`} target="_blank" rel="noreferrer">Trust statement</a></li>
            <li><a href={`${REPO}/blob/main/PHASE0.md`} target="_blank" rel="noreferrer">Why it is built this way</a></li>
            <li><a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT licence</a></li>
          </ul>
        </div>
      </div>

      <div className="foot-bar">
        <span>MIT licensed · open source · unaudited</span>
        <span>STRK20 Private Sprint · submissions close 31 Aug 2026, 23:59 UTC</span>
      </div>
    </footer>
  );
}
