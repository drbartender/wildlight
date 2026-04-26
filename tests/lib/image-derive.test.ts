import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { deriveWebFromPrint } from '@/lib/image-derive';

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 64, g: 96, b: 32 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe('deriveWebFromPrint', () => {
  it('resizes to 2000px on long edge for landscape input', async () => {
    const input = await makeJpeg(4000, 3000);
    const out = await deriveWebFromPrint(input);
    expect(out.contentType).toBe('image/jpeg');
    const meta = await sharp(out.buf).metadata();
    expect(meta.width).toBe(2000);
    expect(meta.height).toBe(1500);
  });

  it('resizes to 2000px on long edge for portrait input', async () => {
    const input = await makeJpeg(3000, 4000);
    const out = await deriveWebFromPrint(input);
    const meta = await sharp(out.buf).metadata();
    expect(meta.width).toBe(1500);
    expect(meta.height).toBe(2000);
  });

  it('does not upscale a small input', async () => {
    const input = await makeJpeg(800, 600);
    const out = await deriveWebFromPrint(input);
    const meta = await sharp(out.buf).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });

  it('strips ICC profile and arbitrary EXIF', async () => {
    const input = await sharp({
      create: { width: 1000, height: 1000, channels: 3, background: '#888' },
    })
      .withMetadata({ icc: 'sRGB' })
      .jpeg()
      .toBuffer();
    const out = await deriveWebFromPrint(input);
    const meta = await sharp(out.buf).metadata();
    expect(meta.icc).toBeUndefined();
  });
});
