import "server-only";
import sharp from "sharp";

/**
 * Turns a logo image into an ESC/POS raster bitmap — server-only, since it
 * needs sharp (native image processing, not available in the browser or in
 * React Native).
 *
 * A thermal head prints one dot per bit: no greyscale, no anti-aliasing. A
 * photo-quality logo dithers into visual noise at 203dpi, so this goes
 * straight to a hard black/white threshold rather than an error-diffusion
 * dither — flat brand marks (which is what a restaurant logo almost always
 * is) hold their shape far better under a threshold than a photo would.
 */

export interface RasterImage {
  /** Always a multiple of 8 — GS v 0 packs 8 dots per byte. */
  widthPx: number;
  heightPx: number;
  /** 1 bit per pixel, MSB first, row-major: 1 = print (black), 0 = blank. */
  bits: Uint8Array;
}

/**
 * Fetch `url` and rasterize it to `maxWidthPx` wide (rounded down to a
 * multiple of 8), preserving aspect ratio. Returns null rather than throwing
 * on any failure — a receipt must still print without its logo rather than
 * fail the whole job over a broken image URL.
 */
export async function rasterizeLogo(url: string, maxWidthPx: number): Promise<RasterImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const input = Buffer.from(await res.arrayBuffer());

    const width = maxWidthPx - (maxWidthPx % 8);
    const { data, info } = await sharp(input)
      .resize({ width, fit: "inside", withoutEnlargement: true })
      // Flatten onto white first: a transparent PNG's alpha=0 pixels are
      // arbitrary underlying color, and without this they can threshold to
      // black — the exact opposite of what transparency is meant to convey
      // on paper.
      .flatten({ background: "#ffffff" })
      .greyscale()
      .threshold(128)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width - (info.width % 8) || 8;
    const h = info.height;
    const rowBytes = w / 8;
    const bits = new Uint8Array(rowBytes * h);

    // `data` is one greyscale byte per pixel post-threshold: 0 or 255.
    // Pack 8 source pixels into each output byte, MSB first — printer black
    // (bit=1) for pixel value 0 (post-threshold black).
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const srcIdx = y * info.width + x; // info.width, not w — source stride before truncation
        const black = data[srcIdx] < 128;
        if (black) {
          const byteIdx = y * rowBytes + (x >> 3);
          bits[byteIdx] |= 0x80 >> (x & 7);
        }
      }
    }

    return { widthPx: w, heightPx: h, bits };
  } catch {
    return null;
  }
}
