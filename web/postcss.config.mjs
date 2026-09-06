/**
 * Tailwind v4, added alongside 1,800 lines of hand-written CSS rather than replacing it.
 *
 * The whole configuration lives in `app/tailwind.css` — v4 is CSS-first — and the two
 * decisions that keep it from touching the existing design are made there: preflight is
 * never imported, and every utility is prefixed. See that file.
 */
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
