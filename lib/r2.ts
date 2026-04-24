import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId) throw new Error('R2_ACCOUNT_ID missing');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

function publicBucket(): string {
  const b = process.env.R2_BUCKET_PUBLIC;
  if (!b) throw new Error('R2_BUCKET_PUBLIC missing');
  return b;
}

function privateBucket(): string {
  const b = process.env.R2_BUCKET_PRIVATE;
  if (!b) throw new Error('R2_BUCKET_PRIVATE missing');
  return b;
}

function publicBase(): string {
  const b = process.env.R2_PUBLIC_BASE_URL;
  if (!b) throw new Error('R2_PUBLIC_BASE_URL missing');
  return b.replace(/\/$/, '');
}

export async function uploadPublic(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const c = client();
  await c.send(
    new PutObjectCommand({
      Bucket: publicBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return `${publicBase()}/${key}`;
}

export async function uploadPrivate(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const c = client();
  await c.send(
    new PutObjectCommand({
      Bucket: privateBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return key;
}

export async function signedPrivateUrl(key: string, expiresInSec = 3600): Promise<string> {
  const c = client();
  return getSignedUrl(
    c,
    new GetObjectCommand({ Bucket: privateBucket(), Key: key }),
    { expiresIn: expiresInSec },
  );
}
