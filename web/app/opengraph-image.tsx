import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The card every shared link renders from.
 *
 * Built with `next/og` rather than exported from a design tool, so the type is real type
 * — it stays crisp at any scale a platform decides to resample to, and the wording can
 * change without a re-export. Bodoni Moda is loaded from the same file the site uses, so
 * the display face matches rather than approximates.
 *
 * The ground and the accent are the site's own tokens. A card that does not look like
 * the page it opens is worse than no card.
 */
export const runtime = "nodejs";
export const alt = "Vickrey — sealed-bid auctions where not even the winner's bid is published";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const [mark, bodoni, sans] = await Promise.all([
    readFile(join(process.cwd(), "public/og-mark.png")),
    readFile(join(process.cwd(), "public/BodoniModa-Static.ttf")).catch(() => null),
    readFile(join(process.cwd(), "public/InstrumentSans-Static.ttf")).catch(() => null),
  ]);
  const markSrc = `data:image/png;base64,${mark.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          justifyContent: "center", gap: 92, padding: "0 84px",
          backgroundColor: "#0A1514",
          /* Satori resolves these in order and does not blend as a browser would, so the
             wash is stated once and strongly rather than layered three times faintly. */
          backgroundImage:
            "radial-gradient(900px 620px at 96% -12%, rgba(242,145,63,0.42), rgba(226,81,60,0.14) 42%, rgba(10,21,20,0) 72%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={markSrc} width={168} height={138} alt="" />
          <div
            style={{
              fontFamily: bodoni ? "Bodoni" : "serif",
              fontSize: 116, color: "#EDF2EF", letterSpacing: "-0.02em", lineHeight: 1,
            }}
          >
            Vickrey
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              fontFamily: bodoni ? "Bodoni" : "serif",
              fontSize: 82, color: "#EDF2EF", lineHeight: 1.1, letterSpacing: "-0.015em",
              maxWidth: 940,
            }}
          >
            Not even the winner&rsquo;s own bid.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ width: 132, height: 4, borderRadius: 2,
                          background: "linear-gradient(100deg, #E2513C, #F2913F)" }} />
            <div style={{ fontFamily: sans ? "Sans" : "sans-serif",
                          fontSize: 29, color: "#A9B8B2", letterSpacing: "0.01em" }}>
              Sealed-bid auctions on STRK20 · vickrey.0xo.in
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        ...(bodoni ? [{ name: "Bodoni", data: bodoni, weight: 600 as const, style: "normal" as const }] : []),
        ...(sans ? [{ name: "Sans", data: sans, weight: 500 as const, style: "normal" as const }] : []),
      ],
    },
  );
}
