import sharp from 'sharp';
import { getPrivateBuffer } from './r2';

/**
 * Read a print master from R2 and return its orientation-corrected pixel
 * dimensions. Mirrors scripts/backfill-print-dims.ts so every path that
 * changes a master measures it the same way.
 */
export async function measureMasterDims(
  key: string,
): Promise<{ width: number; height: number }> {
  if (!key.startsWith('artworks-print/')) {
    throw new Error(`refusing to measure non-print key: ${key}`);
  }
  const buf = await getPrivateBuffer(key);
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error('no dimensions read');
  const rotated = (meta.orientation ?? 1) >= 5 && (meta.orientation ?? 1) <= 8;
  return rotated
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
}
