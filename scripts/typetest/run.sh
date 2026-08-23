#!/usr/bin/env bash
# Renders the Bodoni specimen at 1080p, encodes it at demo bitrates, and pulls frames
# back out so the hairlines can be inspected after compression.
#
# Bodoni Moda is a didone: its thin strokes are the whole point and the first thing
# H.264 quantization throws away. Worth checking before the video, not after.
#
#   scripts/typetest/run.sh [outdir]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:-$HERE/out}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$OUT"

"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=6000 --window-size=1920,1080 \
  --screenshot="$OUT/source.png" "file://$HERE/specimen.html" 2>/dev/null

for BR in 800k 2500k 6000k; do
  ffmpeg -loglevel error -y -loop 1 -i "$OUT/source.png" -t 3 -r 30 \
    -c:v libx264 -preset medium -b:v $BR -maxrate $BR -bufsize $((${BR%k}*2))k \
    -pix_fmt yuv420p "$OUT/enc_$BR.mp4"
  ffmpeg -loglevel error -y -sseof -1 -i "$OUT/enc_$BR.mp4" -frames:v 1 "$OUT/frame_$BR.png"
done

# A still compresses too well to be a fair test; a slow pan is what a screen
# recording actually looks like.
ffmpeg -loglevel error -y -loop 1 -i "$OUT/source.png" -t 4 -r 30 \
  -vf "zoompan=z='min(zoom+0.0006,1.10)':d=120:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080,format=yuv420p" \
  -c:v libx264 -preset medium -b:v 2500k -maxrate 2500k -bufsize 5000k "$OUT/pan_2500k.mp4"
ffmpeg -loglevel error -y -sseof -0.5 -i "$OUT/pan_2500k.mp4" -frames:v 1 "$OUT/pan_frame.png"

# The failing case, kept so the result stays checkable.
ffmpeg -loglevel error -y -loop 1 -i "$OUT/source.png" -t 3 -r 30 -vf "scale=1280:720,format=yuv420p" \
  -c:v libx264 -preset medium -b:v 1200k -maxrate 1200k -bufsize 2400k "$OUT/enc_720p.mp4"
ffmpeg -loglevel error -y -sseof -1 -i "$OUT/enc_720p.mp4" -frames:v 1 "$OUT/frame_720p.png"

echo "frames in $OUT — compare frame_*.png against source.png"
