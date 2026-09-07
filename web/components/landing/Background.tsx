/**
 * The template's background: six rows of ten blocks, each a dot with a line to the
 * right and a line downward, and a light beam that travels each line now and then.
 *
 * The template drew every beam with a motion library — an animated SVG gradient per
 * line, random duration and delay. Here each line is a div and the beam is its
 * pseudo-element on a CSS keyframe, run only under `[data-motion="play"]`. Sixty
 * blocks, a hundred and twenty beams, transform-only, no runtime.
 *
 * The randomness is seeded from the block index so the server and the client agree
 * on every delay — `Math.random()` in render would hydrate to a mismatch.
 */
const ROWS = 6, COLS = 10;
const rnd = (i: number) => { const x = Math.sin(i * 9301 + 49297) * 233280; return x - Math.floor(x); };
const timing = (i: number) => ({
  ["--dur" as string]: `${(1 + rnd(i) * 2).toFixed(2)}s`,
  ["--delay" as string]: `${5 + Math.floor(rnd(i + 11) * 6)}s`,
});

export function Background() {
  return (
    <div className="lp-bg tw:pointer-events-none tw:absolute tw:inset-0 tw:z-0 tw:h-full tw:w-full tw:overflow-hidden" aria-hidden="true">
      {/* Each row is 2400px of blocks; clipped here as well as by the container, because
          the audit reads a row whose content is wider than its box as a spill. */}
      {Array.from({ length: ROWS }, (_, r) => (
        <div className="tw:flex tw:overflow-hidden" key={r}>
          {Array.from({ length: COLS }, (_, c) => {
            const i = r * COLS + c;
            return (
              <div key={c} className="tw:flex tw:w-60 tw:flex-col tw:items-start tw:justify-center">
                <div className="tw:flex tw:items-center tw:justify-center">
                  <div className="tw:flex tw:h-6 tw:w-6 tw:items-center tw:justify-center tw:rounded-full tw:bg-white">
                    <div className="tw:h-2 tw:w-2 tw:rounded-full tw:bg-neutral-200" />
                  </div>
                  <div className="lp-line lp-line-h" style={timing(i)} />
                </div>
                <div className="lp-line lp-line-v tw:ml-3" style={timing(i + 60)} />
              </div>
            );
          })}
        </div>
      ))}
      {/* The template's white layer, masked so the grid fades towards the edges. */}
      <div className="tw:absolute tw:inset-0 tw:h-full tw:w-full tw:bg-white tw:[mask-image:radial-gradient(ellipse_at_center,transparent,white)]" />
    </div>
  );
}
