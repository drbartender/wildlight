import sharp from 'sharp';

export interface DerivedImage {
  buf: Buffer;
  contentType: 'image/jpeg';
}

const MAX_LONG_EDGE = 2000;
const JPEG_QUALITY = 85;

/**
 * Resize a print master to a web-tier JPEG. The long edge is capped at
 * MAX_LONG_EDGE without upscaling smaller inputs. ICC and arbitrary EXIF
 * are stripped; sRGB is forced. Sharp auto-rotates per the orientation tag
 * before stripping.
 */
export async function deriveWebFromPrint(
  source: Buffer,
): Promise<DerivedImage> {
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
  return { buf, contentType: 'image/jpeg' };
}
