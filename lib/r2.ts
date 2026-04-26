import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
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

export async function signedPrivateUploadUrl(
  key: string,
  contentType: string,
  expiresInSec = 900,
): Promise<string> {
  const c = client();
  return getSignedUrl(
    c,
    new PutObjectCommand({
      Bucket: privateBucket(),
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: expiresInSec },
  );
}

export async function copyAndDeletePrivate(
  srcKey: string,
  dstKey: string,
): Promise<void> {
  const c = client();
  const bucket = privateBucket();
  await c.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: dstKey,
      CopySource: `${bucket}/${encodeURIComponent(srcKey)}`,
    }),
  );
  await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: srcKey }));
}

export async function getPrivateBuffer(key: string): Promise<Buffer> {
  const c = client();
  const res = await c.send(
    new GetObjectCommand({ Bucket: privateBucket(), Key: key }),
  );
  if (!res.Body) throw new Error(`r2 get: empty body for ${key}`);
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deletePrivate(key: string): Promise<void> {
  const c = client();
  await c.send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: key }));
}

export async function deletePublic(key: string): Promise<void> {
  const c = client();
  await c.send(new DeleteObjectCommand({ Bucket: publicBucket(), Key: key }));
}

async function listPrefix(
  bucket: string,
  prefix: string,
): Promise<Array<{ key: string; lastModified: Date | null; size: number }>> {
  const c = client();
  const out: Array<{ key: string; lastModified: Date | null; size: number }> = [];
  let continuationToken: string | undefined;
  do {
    const res = await c.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue;
      out.push({
        key: obj.Key,
        lastModified: obj.LastModified ?? null,
        size: obj.Size ?? 0,
      });
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
  return out;
}

export function listPrivatePrefix(prefix: string) {
  return listPrefix(privateBucket(), prefix);
}

export function listPublicPrefix(prefix: string) {
  return listPrefix(publicBucket(), prefix);
}
