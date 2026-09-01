/**
 * Real image byte generators for the profile-image flow (TOV-30) unit / integration / e2e suites.
 *
 * Every function here produces REAL, decodable bytes (via `sharp`, or a hand-built valid GIF89a) —
 * NOT mocks — so they can be stored through `FakeProfileStorage` and round-tripped through the real
 * `sharp` validation / derivative pipeline exactly as production bytes would be. `sharp` is added to
 * package.json separately.
 */
import sharp from 'sharp';

/** A solid JPEG (default 800x600). */
export function makeJpeg(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 68, g: 119, b: 170 } },
  })
    .jpeg()
    .toBuffer();
}

/** A solid PNG (default 400x400). */
export function makePng(width = 400, height = 400): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 68, g: 119, b: 170 } },
  })
    .png()
    .toBuffer();
}

/** A solid WebP (default 300x300). */
export function makeWebp(width = 300, height = 300): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 68, g: 119, b: 170 } },
  })
    .webp()
    .toBuffer();
}

/** A tiny 32x32 JPEG — for the `withoutEnlargement` / no-upscale assertion. */
export function makeTinyJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 68, g: 119, b: 170 } },
  })
    .jpeg()
    .toBuffer();
}

/** A very wide 9000x100 PNG — exceeds an 8000px max-dimension gate. */
export function makeOversizedPng(): Promise<Buffer> {
  return sharp({
    create: { width: 9000, height: 100, channels: 3, background: { r: 68, g: 119, b: 170 } },
  })
    .png()
    .toBuffer();
}

/**
 * A real, minimal 2-frame animated GIF89a (1x1, black frame then white frame, infinite loop).
 *
 * ASSUMPTION: rather than rely on `sharp`'s finicky animated-GIF ENCODE path (which needs a tall
 * `pageHeight`-tagged input and the optional `libvips`/`cgif` support to be present), we hand-build a
 * spec-valid 2-frame GIF89a as a hardcoded byte Buffer. It decodes as animated — `sharp(buf, { animated:
 * true }).metadata().pages === 2` — which is all the "reject animated" gate needs to assert.
 *
 * Layout: header, logical screen descriptor, 2-entry global color table (black/white), NETSCAPE2.0
 * looping extension, then two frames (each: graphic-control ext + image descriptor + LZW image data).
 *
 * Returned as a resolved `Promise<Buffer>` to match the async family (`await` works either way).
 */
export function makeAnimatedGif(): Promise<Buffer> {
  // prettier-ignore
  const bytes: number[] = [
    // "GIF89a"
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    // Logical Screen Descriptor: 1x1, packed=0x80 (GCT present, 2 entries), bg=0, aspect=0
    0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
    // Global Color Table: index 0 = black, index 1 = white
    0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
    // NETSCAPE2.0 application extension (loop forever)
    0x21, 0xff, 0x0b,
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, // "NETSCAPE2.0"
    0x03, 0x01, 0x00, 0x00, 0x00,
    // Frame 1 — Graphic Control Extension (delay 10cs)
    0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00,
    // Frame 1 — Image Descriptor (0,0 1x1, no local color table)
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    // Frame 1 — LZW image data: min code size 2, one pixel = index 0
    0x02, 0x02, 0x44, 0x01, 0x00,
    // Frame 2 — Graphic Control Extension (delay 10cs)
    0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00,
    // Frame 2 — Image Descriptor (0,0 1x1, no local color table)
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    // Frame 2 — LZW image data: min code size 2, one pixel = index 1
    0x02, 0x02, 0x4c, 0x01, 0x00,
    // Trailer
    0x3b,
  ];
  return Promise.resolve(Buffer.from(bytes));
}

/** Definitely-not-an-image bytes — for the content-type / decode-failure gate. */
export function notAnImage(): Buffer {
  return Buffer.from('this is definitely not an image');
}
