/**
 * The dashboard's icon set, drawn rather than imported.
 *
 * A second icon library would arrive with its own stroke weight, corner radius and
 * optical grid, and the sidebar would then be the one place in the app that looks like
 * somebody else's product. These match what is already here: 18px box, 1.6 stroke,
 * round caps and joins, `currentColor`, no fills — the same construction as the
 * notification bell.
 *
 * Where a shape can carry the protocol's own vocabulary it does. Auctions and My bids
 * are built from rungs, because the ladder is the object this whole app is about.
 */
const S = {
  width: 18, height: 18, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.6,
  strokeLinecap: "round", strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const IconOverview = () => (
  <svg {...S}><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>
);

/* Rungs: the ladder, which is what an auction is here. */
export const IconAuctions = () => (
  <svg {...S}><path d="M4 6h16M4 12h16M4 18h16" /><path d="M8 3v18" /></svg>
);

/* One rung marked — your level among the others, which is exactly what a bid is. */
export const IconBids = () => (
  <svg {...S}><path d="M4 6h16M4 18h16" /><path d="M4 12h16" strokeWidth="3" /></svg>
);

export const IconCreate = () => (
  <svg {...S}><rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M12 8.5v7M8.5 12h7" /></svg>
);

export const IconManage = () => (
  <svg {...S}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
);

export const IconDocs = () => (
  <svg {...S}><path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M14 3v5h5M8.5 13h7M8.5 17h4" /></svg>
);

export const IconPublic = () => (
  <svg {...S}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" /></svg>
);

export const IconGithub = () => (
  <svg {...S}><path d="M15 21v-3.2a2.8 2.8 0 0 0-.8-2.2c2.6-.3 5.3-1.3 5.3-5.8a4.5 4.5 0 0 0-1.2-3.1a4.2 4.2 0 0 0-.1-3.1s-1-.3-3.2 1.2a11 11 0 0 0-5.8 0C6.9 3.3 5.9 3.6 5.9 3.6a4.2 4.2 0 0 0-.1 3.1a4.5 4.5 0 0 0-1.2 3.2c0 4.4 2.7 5.4 5.3 5.7a2.8 2.8 0 0 0-.8 2.2V21" />
    <path d="M9 18.5c-2.6.8-4.2 0-5-1.5" /></svg>
);
