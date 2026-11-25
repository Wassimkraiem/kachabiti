import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { config } from '../config';
import type { Database } from '../db/database';

// Derived from AUTH_SECRET: if that changes, the Page must be connected again.
const key = Buffer.from(
  hkdfSync('sha256', config.AUTH_SECRET, '', 'meta-connection', 32),
);

export function seal(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}

/** Null when it was tampered with or sealed with another AUTH_SECRET. */
export function unseal(sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12), {
      authTagLength: 16,
    });
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** The Page's events we need; echoes are the replies sent from Messenger or Business Suite. */
export const PAGE_FIELDS = ['messages', 'message_echoes', 'feed'];

// When the webhook last got something since the API started, for Connections → Check.
export const received: Record<string, string | null> = {
  page: null,
  instagram: null,
  refused: null,
};

/** The connected Page with its token, or null. */
export async function metaConnection(db: Database) {
  const row = await db
    .selectFrom('meta_connection')
    .selectAll()
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  const token = row && unseal(row.token_encrypted);
  return row && token ? { ...row, token } : null;
}

/** The token replies are sent with: the connected Page's, else the server's META_PAGE_ACCESS_TOKEN. */
export const metaPageToken = async (db: Database) =>
  (await metaConnection(db))?.token ??
  (process.env.META_PAGE_ACCESS_TOKEN || null);
