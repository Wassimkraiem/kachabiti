import { AwsClient } from 'aws4fetch';
import { config } from '../config';
import { ApiError } from './api';

// Files in S3-compatible storage (AWS S3 in production, SeaweedFS locally), path-style URLs.
// Buckets: `products` (public: shop images, read at FILES_PUBLIC_URL) and `documents` (private:
// reached only through signed links).

export type Bucket = 'products' | 'documents';

let client: AwsClient | null = null;
let expiresAt = Infinity;

/**
 * Signs with S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY when set (local SeaweedFS), otherwise with the
 * server's EC2 instance role (production): short-lived keys from the metadata service, renewed
 * 5 minutes before they expire.
 */
async function storage() {
  if (!config.S3_ENDPOINT)
    throw new ApiError('File storage is not configured.', 503);
  if (client && Date.now() < expiresAt - 5 * 60_000) return client;
  if (config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY) {
    client = new AwsClient({
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      service: 's3',
      region: config.S3_REGION,
    });
    return client;
  }
  const keys = await instanceRoleKeys();
  client = new AwsClient({
    accessKeyId: keys.AccessKeyId,
    secretAccessKey: keys.SecretAccessKey,
    sessionToken: keys.Token,
    service: 's3',
    region: config.S3_REGION,
  });
  expiresAt = Date.parse(keys.Expiration);
  return client;
}

const METADATA = 'http://169.254.169.254/latest';

/** The instance role's keys (IMDSv2: a session token first). */
async function instanceRoleKeys(): Promise<{
  AccessKeyId: string;
  SecretAccessKey: string;
  Token: string;
  Expiration: string;
}> {
  const read = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${METADATA}${path}`, {
      ...init,
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok)
      throw new Error(`Instance metadata ${path}: ${response.status}`);
    return response.text();
  };
  const token = await read('/api/token', {
    method: 'PUT',
    headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' },
  });
  const headers = { 'X-aws-ec2-metadata-token': token };
  const path = '/meta-data/iam/security-credentials/';
  const role = (await read(path, { headers })).trim().split('\n')[0];
  return JSON.parse(await read(path + role, { headers }));
}

function objectUrl(bucket: Bucket, key: string) {
  const path = key.split('/').map(encodeURIComponent).join('/');
  const name = {
    products: config.S3_PRODUCTS_BUCKET,
    documents: config.S3_DOCUMENTS_BUCKET,
  }[bucket];
  return `${config.S3_ENDPOINT}/${name}/${path}`;
}

async function send(url: string, init: RequestInit) {
  const response = await (await storage()).fetch(url, init);
  if (!response.ok && response.status !== 404)
    throw new Error(
      `Storage ${init.method} failed: ${response.status} ${await response.text()}`,
    );
}

export const putObject = (
  bucket: Bucket,
  key: string,
  body: Buffer,
  contentType: string,
) =>
  send(objectUrl(bucket, key), {
    method: 'PUT',
    body: new Uint8Array(body),
    headers: {
      'Content-Type': contentType,
      'Cache-Control':
        bucket === 'products'
          ? 'public, max-age=31536000, immutable'
          : 'private',
    },
  });

export const deleteObject = (bucket: Bucket, key: string) =>
  send(objectUrl(bucket, key), { method: 'DELETE' });

/** A link that downloads a private file for `seconds`, under its original name. */
export async function signedUrl(
  bucket: Bucket,
  key: string,
  seconds: number,
  fileName?: string | null,
) {
  const signer = await storage();
  const url = new URL(objectUrl(bucket, key));
  url.searchParams.set('X-Amz-Expires', String(seconds));
  if (fileName)
    url.searchParams.set(
      'response-content-disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
  const signed = await signer.sign(url.toString(), {
    method: 'GET',
    aws: { signQuery: true },
  });
  return signed.url;
}

/** Where the shop reads a public product file. */
export function publicUrl(key: string) {
  if (!config.FILES_PUBLIC_URL)
    throw new ApiError('File storage is not configured.', 503);
  return `${config.FILES_PUBLIC_URL}/${key}`;
}
