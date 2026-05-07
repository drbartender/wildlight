import sharp from 'sharp';

// Bound libvips threading on Vercel functions (~1-2 vCPU but `os.cpus()`
// reports the host count). Module-level call so any sharp() instance —
// here, in lib/anthropic-image.ts, or anywhere else — picks it up.
sharp.concurrency(1);

export interface DerivedImage {
  buf: Buffer;
  contentType: 'image/jpeg';
  /** Master dimensions, post-EXIF-rotation (what the admin actually sees). */
  masterWidth: number;
  masterHeight: number;
}

const MAX_LONG_EDGE = 2000;
const JPEG_QUALITY = 85;
// Decompression-bomb guard. A 25 MB PNG can decode to 1+ GB RGBA at
// pathological dimensions (16k+ on a side); 100 MP comfortably covers
// any real camera output (~12k × 8k). Sharp's default of ~268 MP is
// too permissive given the upload caps in our routes.
const LIMIT_INPUT_PIXELS = 100_000_000;

/**
 * Resize an image source to a web-tier JPEG. The long edge is capped at
 * MAX_LONG_EDGE without upscaling smaller inputs. ICC and arbitrary EXIF
 * are stripped; sRGB is forced. Sharp auto-rotates per the orientation tag
 * before stripping.
 *
 * Also returns the input's post-rotation dimensions so the caller can
 * persist them on the artwork row and classify print resolution without
 * a second sharp pass.
 *
 * Name says "from print" because the original use was deriving a web
 * tier from a print master — the implementation has always accepted
 * any Buffer input, and is now also called from the single-upload
 * route to size raw web uploads.
 */
export async function deriveWebFromPrint(
  source: Buffer,
): Promise<DerivedImage> {
  // Header-only metadata read — chaining .rotate() before .metadata()
  // does NOT swap w/h on every sharp version, so we read raw dims +
  // orientation and swap manually for orientations 5–8 (90/270° rotations).
  const meta = await sharp(source, { limitInputPixels: LIMIT_INPUT_PIXELS })
    .metadata();
  if (!meta.width || !meta.height) {
    throw new Error('image-derive: could not read master dimensions');
  }
  const rotated = (meta.orientation ?? 1) >= 5 && (meta.orientation ?? 1) <= 8;
  const masterWidth = rotated ? meta.height : meta.width;
  const masterHeight = rotated ? meta.width : meta.height;

  const buf = await sharp(source, { limitInputPixels: LIMIT_INPUT_PIXELS })
    .rotate()
    .resize({
      width: MAX_LONG_EDGE,
      height: MAX_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toColorspace('srgb')
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return {
    buf,
    contentType: 'image/jpeg',
    masterWidth,
    masterHeight,
  };
}
