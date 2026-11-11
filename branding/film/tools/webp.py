#!/usr/bin/env python3
"""The README version of the film: an animated WebP that loops.

    python3 tools/webp.py out/film.mp4 stellarr.webp [WIDTH=800] [FPS=15] [QUALITY=75]

Encoded with libwebp through Pillow, every frame a key frame (kmax=1). ffmpeg's libwebp_anim
updates only the changed parts of each frame, and on the app's dark, nearly flat surfaces those
lossy patches leave visible rectangles; whole frames do not, at about 7 MB for the full minute.
Needs ffmpeg and Pillow.
"""
import subprocess, sys, tempfile, time
from pathlib import Path

from PIL import Image

src, out = sys.argv[1], Path(sys.argv[2])
width = int(sys.argv[3]) if len(sys.argv) > 3 else 800
fps = int(sys.argv[4]) if len(sys.argv) > 4 else 15
quality = int(sys.argv[5]) if len(sys.argv) > 5 else 75

t0 = time.time()
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", f"fps={fps},scale={width}:-2:flags=lanczos", f"{tmp}/f%05d.png"], check=True)
    frames = [Image.open(p).convert("RGB") for p in sorted(Path(tmp).glob("f*.png"))]
    part = out.with_name(out.name + ".part")
    frames[0].save(part, format="WEBP", save_all=True, append_images=frames[1:], duration=1000 / fps, loop=0,
                   quality=quality, method=4, kmin=0, kmax=1, allow_mixed=False, minimize_size=False)
    part.replace(out)
print(f"{out}: {len(frames)} frames at {fps} fps, {width} px, {out.stat().st_size / 1e6:.1f} MB, {time.time() - t0:.0f} s")
