import Link from "next/link";
import { config, explorerContract } from "@/lib/config";
import { Wordmark } from "@/components/Wordmark";

const REPO = "https://github.com/Vickrey-Protocol/vickrey";

const LINK =
  "tw:inline-flex tw:items-center tw:text-sm tw:text-neutral-500 tw:no-underline tw:transition-colors " +
  "tw:hover:text-black tw:max-lg:min-h-11";

/** A contract row renders only when the address is actually configured. */
function Contract({ label, address }: { label: string; address: string }) {
  if (!address) return <span className="tw:text-sm tw:text-neutral-400">{label} — not deployed</span>;
  return (
    <a href={explorerContract(address)} target="_blank" rel="noreferrer" className={LINK}>
      {label}&nbsp;<span className="tw:font-mono tw:text-xs">{address.slice(0, 8)}…{address.slice(-4)}</span>
    </a>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tw:flex tw:flex-col tw:gap-3">
      <p className="tw:text-sm tw:font-medium tw:text-black">{title}</p>
      {children}
    </div>
  );
}

/**
 * The template's footer: brand at left, three columns of links, and the name set
 * enormous in a gradient beneath. Ours carries the contracts by address, because a
 * visitor who has not connected anything is still entitled to know where the code is.
 */
export function LpFooter() {
  /* The name below is sized to the viewport, not to a breakpoint: at 18rem it was 1245px
     wide on a 1024px screen and widened the whole document. The footer clips as well, so
     no future size can do that again. */
  return (
    <footer className="lp-footer tw:relative tw:m-0 tw:overflow-hidden tw:border-0 tw:p-0">
      <div className="tw:border-t tw:border-neutral-100 tw:bg-white tw:px-8 tw:pt-20 tw:pb-24">
        <div className="tw:mx-auto tw:flex tw:max-w-7xl tw:flex-col tw:items-start tw:justify-between tw:gap-10 tw:sm:flex-row">
          <div className="tw:max-w-xs">
            <Wordmark href={null} size={20} />
            <p className="tw:mt-4 tw:text-sm tw:text-neutral-500">
              Sealed-bid auctions on STRK20. The losing bids are never published, and the
              outcome is proved on-chain rather than asserted.
            </p>
            <p className="tw:mt-4 tw:inline-flex tw:items-center tw:rounded-full tw:border tw:border-neutral-200 tw:px-3 tw:py-1 tw:font-mono tw:text-xs tw:uppercase tw:tracking-widest tw:text-neutral-500">
              {config.label}
            </p>
          </div>
          <div className="tw:grid tw:grid-cols-1 tw:gap-10 tw:sm:grid-cols-3">
            <Column title="Product">
              <Link href="/auctions" className={LINK}>Auctions</Link>
              <Link href="/#how" className={LINK}>How it works</Link>
              <Link href="/docs" className={LINK}>Docs</Link>
              <Link href="/#faq" className={LINK}>FAQ</Link>
            </Column>
            <Column title="Contracts">
              <Contract label="Auction" address={config.auctionAddress} />
              <Contract label="Anonymizer" address={config.anonymizerAddress} />
              <Contract label="STRK20 pool" address={config.poolAddress} />
            </Column>
            <Column title="Resources">
              <a href={REPO} target="_blank" rel="noreferrer" className={LINK}>Source on GitHub</a>
              <a href={`${REPO}#readme`} target="_blank" rel="noreferrer" className={LINK}>README</a>
              <a href={`${REPO}/blob/main/TRUST.md`} target="_blank" rel="noreferrer" className={LINK}>Trust statement</a>
              <a href={`${REPO}/blob/main/PHASE0.md`} target="_blank" rel="noreferrer" className={LINK}>Why it is built this way</a>
              <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className={LINK}>MIT licence</a>
            </Column>
          </div>
        </div>
        <div className="tw:mx-auto tw:mt-16 tw:flex tw:max-w-7xl tw:flex-wrap tw:justify-between tw:gap-2 tw:font-mono tw:text-xs tw:uppercase tw:tracking-widest tw:text-neutral-400">
          <span>MIT licensed · open source · unaudited</span>
          <span>STRK20 Private Sprint</span>
        </div>
      </div>
      <p aria-hidden="true" className="tw:m-0 tw:bg-linear-to-b tw:from-neutral-50 tw:to-neutral-200 tw:bg-clip-text tw:text-center tw:text-[clamp(4rem,17vw,18rem)] tw:font-bold tw:leading-none tw:text-transparent">
        VICKREY
      </p>
    </footer>
  );
}
