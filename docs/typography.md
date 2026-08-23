# Bodoni under compression

Bodoni Moda is a didone. Its hairlines are the reason it looks like an auction
catalogue, and they are also the first thing H.264 quantization discards. Tested
before committing to it for the demo video, not after.

Reproduce with `scripts/typetest/run.sh`.

## Method

A 1920×1080 specimen carrying the three sizes the interface actually uses — 45px hero,
30px title, 21px wordmark — on both the light and dark grounds, encoded with
`libx264`, `yuv420p` (the 4:2:0 subsampling every platform applies), then a frame
pulled back out.

A still image compresses almost for free, so a static-frame test flatters the type.
There is a second pass with a slow zoom to put real bitrate pressure on the encoder,
which is closer to a screen recording.

## Result

| Case | 45px | 30px | 21px |
|---|---|---|---|
| 1080p @ 6000k | clean | clean | clean |
| 1080p @ 2500k | clean | clean | clean |
| 1080p @ 2500k, panning | clean | clean | clean |
| 1080p @ 800k | clean | clean | slight softening |
| **720p @ 1200k** | acceptable | **degraded** | **degraded** |

**Bodoni stays.** At 1080p the hairlines survive every bitrate tested, on both grounds,
including under motion. The seal-red period on the wordmark holds too.

**At 720p it stops being Bodoni.** The thin strokes thicken and break up; the
letterforms are still legible but the high contrast that carries the identity is gone,
and the 21px wordmark is the worst of it.

## What this means for the video

- **Export at 1080p.** Not a preference — 720p is where the type fails.
- **Nothing in Bodoni below 30px in a shot the video lingers on.** The wordmark at
  21px is fine in passing and marginal if held.
- 2500k is comfortable. There is no need to push the bitrate for the type's sake.
- If the recording pipeline downscales anywhere, re-run this. The result is about
  output resolution, not source resolution.
