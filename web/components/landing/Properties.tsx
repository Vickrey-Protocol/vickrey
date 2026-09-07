import Link from "next/link";
import { PROPERTIES, type Property } from "@/lib/properties";

/**
 * The six properties, in the template's icon-grid: a three-by-two of cells with
 * hairlines between, a bar at the left of each title that fills on hover, and a
 * gradient that rises into the cell under the pointer.
 *
 * Where the template had an icon there is the property's number, because these are
 * numbered in the reference and referred to by number ("properties 3 and 4"). The two
 * the reference marks are tagged as the ones genuinely hard to get elsewhere. Every
 * word is the reference's own, read from the same array it renders.
 */
const SIDE = "tw:relative tw:z-10 tw:m-0 tw:max-w-xs tw:px-10 tw:text-sm tw:text-neutral-600 tw:dark:text-neutral-300";

function Cell({ n, title, hard, how, star, index }: Property & { index: number }) {
  const top = index < 3;
  const cls = [
    "tw:group tw:relative tw:flex tw:flex-col tw:border-neutral-200 tw:dark:border-neutral-700 tw:py-10 tw:lg:border-r",
    (index === 0 || index === 3) && "tw:lg:border-l",
    top && "tw:lg:border-b",
  ].filter(Boolean).join(" ");
  return (
    <div className={cls} data-reveal style={{ ["--d" as string]: `${index * 0.06}s` }}>
      <div
        aria-hidden="true"
        className={
          "tw:pointer-events-none tw:absolute tw:inset-0 tw:h-full tw:w-full tw:opacity-0 tw:transition tw:duration-200 tw:group-hover:opacity-100 " +
          (top ? "tw:bg-linear-to-t tw:from-neutral-100 tw:dark:from-neutral-800 tw:to-transparent" : "tw:bg-linear-to-b tw:from-neutral-100 tw:dark:from-neutral-800 tw:to-transparent")
        }
      />
      <div className="tw:relative tw:z-10 tw:mb-4 tw:flex tw:items-center tw:gap-2 tw:px-10 tw:font-mono tw:text-sm tw:text-neutral-500 tw:dark:text-neutral-400">
        <span>{String(n).padStart(2, "0")}</span>
        {star && (
          <span className="tw:rounded-full tw:border tw:border-neutral-300 tw:dark:border-neutral-600 tw:px-2 tw:py-0.5 tw:text-[10px] tw:uppercase tw:tracking-widest tw:text-neutral-600 tw:dark:text-neutral-300">
            hard to get elsewhere
          </span>
        )}
      </div>
      <h3 className="tw:relative tw:z-10 tw:mb-3 tw:px-10 tw:text-lg tw:font-bold tw:tracking-normal tw:text-black tw:dark:text-white">
        <span aria-hidden="true" className="tw:absolute tw:inset-y-0 tw:left-0 tw:h-6 tw:w-1 tw:rounded-tr-full tw:rounded-br-full tw:bg-neutral-300 tw:dark:bg-neutral-700 tw:transition tw:duration-200 tw:group-hover:bg-black tw:dark:group-hover:bg-white" />
        <span className="tw:inline-block tw:transition tw:duration-200 tw:group-hover:translate-x-2">{title}</span>
      </h3>
      <p className={SIDE}><b className="tw:font-semibold tw:text-black tw:dark:text-white">What normally goes wrong:</b> {hard}</p>
      <p className={`${SIDE} tw:mt-3`}><b className="tw:font-semibold tw:text-black tw:dark:text-white">Here:</b> {how}</p>
    </div>
  );
}

export function LpProperties() {
  return (
    <section id="properties" data-anchor className="tw:p-0 tw:py-10 tw:lg:py-20" aria-labelledby="props-h">
      <h2
        id="props-h" data-reveal data-beat="properties"
        className="tw:mx-auto tw:max-w-5xl tw:text-center tw:text-3xl tw:font-medium tw:tracking-tight tw:text-balance tw:md:text-5xl tw:md:leading-tight"
      >
        Six properties, and why each is hard
      </h2>
      <p data-reveal className="tw:mx-auto tw:my-4 tw:max-w-4xl tw:text-center tw:text-sm tw:text-neutral-600 tw:dark:text-neutral-300 tw:text-balance tw:md:text-base">
        Each of these is a place a straightforward implementation breaks. They are listed
        because they are checkable, not because they are features.
      </p>
      <div className="tw:relative tw:z-10 tw:mt-6 tw:grid tw:grid-cols-1 tw:md:grid-cols-2 tw:lg:grid-cols-3">
        {PROPERTIES.map((p, i) => <Cell key={p.n} {...p} index={i} />)}
      </div>
      <p data-reveal className="tw:mt-8 tw:text-center tw:text-sm tw:text-neutral-600 tw:dark:text-neutral-300">
        <Link href="/docs#properties" className="tw:inline-flex tw:items-center tw:max-lg:min-h-11">
          Properties 3 and 4 are marked because they are the two that are genuinely hard to get elsewhere — the reference says why &rarr;
        </Link>
      </p>
    </section>
  );
}
