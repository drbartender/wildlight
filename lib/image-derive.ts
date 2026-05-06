import sharp from 'sharp';

export interface DerivedImage {
  buf: Buffer;
  contentType: 'image/jpeg';
  /** Master dimensions, post-EXIF-rotation (what the admin actually sees). */
  masterWidth: number;
  masterHeight: number;
}

const MAX_LONG_EDGE = 2000;
const JPEG_QUALITY = 85;

/**
 * Resize a print master to a web-tier JPEG. The long edge is capped at
 * MAX_LONG_EDGE without upscaling smaller inputs. ICC and arbitrary EXIF
 * are stripped; sRGB is forced. Sharp auto-rotates per the orientation tag
 * before stripping.
 *
 * Also returns the master's post-rotation dimensions so the caller can
 * persist them on the artwork row and classify print resolution without
 * a second sharp pass.
 */
export async function deriveWebFromPrint(
  source: Buffer,
): Promise<DerivedImage> {
  // Header-only metadata read — chaining .rotate() before .metadata()
  // does NOT swap w/h on every sharp version, so we read raw dims +
  // orientation and swap manually for orientations 5–8 (90/270° rotations).
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('image-derive: could not read master dimensions');
  }
  const rotated = (meta.orientation ?? 1) >= 5 && (meta.orientation ?? 1) <= 8;
  const masterWidth = rotated ? meta.height : meta.width;
  const masterHeight = rotated ? meta.width : meta.height;

  const buf = await sharp(source)
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
