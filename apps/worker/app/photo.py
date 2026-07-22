"""Photo processing core (Slice 10, FR-2): EXIF-orientation transpose ->
downscale -> JPEG re-encode.

RODO: the re-encode is the strip — Pillow's save() writes NO metadata unless
an exif= argument is passed, so GPS/device EXIF (JPEG) and textual chunks
(PNG) cannot survive by construction. exif_transpose runs FIRST, otherwise
phone photos (Orientation 3/6/8) would lose their rotation with the metadata.

Pure — no I/O, no FastAPI import (endpoint lives in main.py). Pillow's
default MAX_IMAGE_PIXELS decompression-bomb guard stays active; a bomb
raises like any other unreadable input and main.py maps it to 415.
"""

from io import BytesIO

from PIL import Image, ImageOps

MAX_PHOTO_BYTES = 10 * 1024 * 1024
MAX_LONG_SIDE = 1200
JPEG_QUALITY = 85


def process_photo(data: bytes) -> tuple[bytes, int, int]:
    img = Image.open(BytesIO(data))
    img = ImageOps.exif_transpose(img)
    img.thumbnail((MAX_LONG_SIDE, MAX_LONG_SIDE))  # downscale-only, keeps aspect
    if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")
    out = BytesIO()
    img.save(out, format="JPEG", quality=JPEG_QUALITY)
    return out.getvalue(), img.width, img.height
