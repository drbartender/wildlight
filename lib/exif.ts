import { parse as parseExif } from 'exifr';

export interface ExifSummary {
  year_shot: number | null;
  gps: { lat: number; lon: number } | null;
}

/**
 * Best-effort EXIF read from a JPEG/PNG buffer. Never throws — on any
 * parse error or missing tag, returns nulls.
 */
export async function readExifFromBuffer(buf: Buffer): Promise<ExifSummary> {
  try {
    const data = (await parseExif(buf, {
      pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'],
    })) as
      | {
          DateTimeOriginal?: Date;
          CreateDate?: Date;
          latitude?: number;
          longitude?: number;
        }
      | null
      | undefined;
    if (!data) return { year_shot: null, gps: null };
    const when = data.DateTimeOriginal ?? data.CreateDate ?? null;
    const year_shot =
      when instanceof Date && !isNaN(+when) ? when.getUTCFullYear() : null;
    const gps =
      typeof data.latitude === 'number' && typeof data.longitude === 'number'
        ? { lat: data.latitude, lon: data.longitude }
        : null;
    return { year_shot, gps };
  } catch {
    return { year_shot: null, gps: null };
  }
}
