import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Messenger, Instagram Direct and WhatsApp Cloud API (Meta). Optional: without the tokens the
 * CRM works by hand (conversations typed in by agents), and nothing here is called.
 *
 *   META_APP_SECRET           verifies webhook signatures (X-Hub-Signature-256)
 *   META_VERIFY_TOKEN         the token entered when subscribing the webhook in Meta's dashboard
 *   META_PAGE_ACCESS_TOKEN    replies on Messenger and Instagram (page linked to the IG account)
 *   WHATSAPP_TOKEN            replies on WhatsApp
 *   WHATSAPP_PHONE_NUMBER_ID  the WhatsApp Business number that sends them
 *
 * Meta only lets a business reply freely within 24 hours of the customer's last message
 * (WhatsApp needs an approved template after that); the Graph API returns an error otherwise.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

export type MetaChannel = 'facebook' | 'instagram' | 'whatsapp';

export const metaConfigured = () => ({
    webhook: Boolean(process.env.META_APP_SECRET && process.env.META_VERIFY_TOKEN),
    facebook: Boolean(process.env.META_PAGE_ACCESS_TOKEN),
    instagram: Boolean(process.env.META_PAGE_ACCESS_TOKEN),
    whatsapp: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
});

/** True when the raw body was signed with the app secret. */
export function validSignature(rawBody: string, header: string | null): boolean {
    const secret = process.env.META_APP_SECRET;
    if (!secret || !header?.startsWith('sha256=')) return false;
    const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
    const given = Buffer.from(header.slice(7));
    return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface IncomingMessage {
    channel: MetaChannel;
    externalId: string;      // message id (dedupes Meta's retries)
    senderId: string;        // PSID / IGSID / WhatsApp number
    senderName: string | null;
    phone: string | null;    // WhatsApp only
    text: string;
    sentAt: Date;
}

type Json = Record<string, unknown>;
const arr = (v: unknown) => (Array.isArray(v) ? (v as Json[]) : []);
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Json) : {});

/** Text messages in a webhook payload (attachments are noted as such; echoes of our own messages are skipped). */
export function parseWebhook(payload: Json): IncomingMessage[] {
    const out: IncomingMessage[] = [];
    const object = payload.object;
    for (const entry of arr(payload.entry)) {
        if (object === 'page' || object === 'instagram') {
            for (const event of arr(entry.messaging)) {
                const message = obj(event.message);
                if (!message.mid || message.is_echo) continue;
                const attachments = arr(message.attachments);
                out.push({
                    channel: object === 'page' ? 'facebook' : 'instagram',
                    externalId: String(message.mid),
                    senderId: String(obj(event.sender).id ?? ''),
                    senderName: null,
                    phone: null,
                    text: typeof message.text === 'string' && message.text ? message.text : attachments.length ? `[${attachments.map((a) => a.type).join(', ')}]` : '[message]',
                    sentAt: new Date(Number(event.timestamp) || Date.now()),
                });
            }
        } else if (object === 'whatsapp_business_account') {
            for (const change of arr(entry.changes)) {
                const value = obj(change.value);
                const names = new Map(arr(value.contacts).map((c) => [String(c.wa_id), String(obj(c.profile).name ?? '')]));
                for (const message of arr(value.messages)) {
                    const from = String(message.from ?? '');
                    const text = obj(message.text).body;
                    out.push({
                        channel: 'whatsapp',
                        externalId: String(message.id),
                        senderId: from,
                        senderName: names.get(from) || null,
                        phone: from,
                        text: typeof text === 'string' ? text : `[${String(message.type ?? 'message')}]`,
                        sentAt: new Date((Number(message.timestamp) || Date.now() / 1000) * 1000),
                    });
                }
            }
        }
    }
    return out.filter((m) => m.senderId);
}

export interface IncomingComment {
    platform: 'facebook' | 'instagram';
    externalId: string;      // comment id (dedupes Meta's retries)
    postId: string | null;
    authorId: string | null;
    authorName: string | null;
    text: string;
    commentedAt: Date;
}

/**
 * New public comments in a webhook payload: the Page's `feed` field (item "comment", verb "add")
 * and the Instagram account's `comments` field. The shop's own replies are skipped.
 */
export function parseComments(payload: Json): IncomingComment[] {
    const out: IncomingComment[] = [];
    for (const entry of arr(payload.entry)) {
        const ownId = String(entry.id ?? '');
        for (const change of arr(entry.changes)) {
            const value = obj(change.value);
            const from = obj(value.from);
            if (String(from.id ?? '') === ownId) continue;
            if (payload.object === 'page' && change.field === 'feed' && value.item === 'comment' && value.verb === 'add' && value.comment_id) {
                out.push({
                    platform: 'facebook',
                    externalId: String(value.comment_id),
                    postId: value.post_id ? String(value.post_id) : null,
                    authorId: from.id ? String(from.id) : null,
                    authorName: typeof from.name === 'string' ? from.name : null,
                    text: typeof value.message === 'string' ? value.message : '',
                    commentedAt: new Date((Number(value.created_time) || Date.now() / 1000) * 1000),
                });
            } else if (payload.object === 'instagram' && change.field === 'comments' && value.id) {
                out.push({
                    platform: 'instagram',
                    externalId: String(value.id),
                    postId: obj(value.media).id ? String(obj(value.media).id) : null,
                    authorId: from.id ? String(from.id) : null,
                    authorName: typeof from.username === 'string' ? from.username : null,
                    text: typeof value.text === 'string' ? value.text : '',
                    commentedAt: new Date((Number(entry.time) || Date.now() / 1000) * 1000),
                });
            }
        }
    }
    return out;
}

/** Sends a text reply. Throws with Meta's message when it refuses. */
export async function sendMetaText(channel: MetaChannel, recipientId: string, text: string): Promise<string | null> {
    let url: string;
    let body: Json;
    let token: string | undefined;
    if (channel === 'whatsapp') {
        token = process.env.WHATSAPP_TOKEN;
        url = `${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
        body = { messaging_product: 'whatsapp', to: recipientId, type: 'text', text: { body: text } };
    } else {
        token = process.env.META_PAGE_ACCESS_TOKEN;
        url = `${GRAPH}/me/messages`;
        body = { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text } };
    }
    if (!token) throw new Error(`${channel} is not connected`);
    const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json().catch(() => ({}))) as Json;
    if (!response.ok) throw new Error(String(obj(json.error).message ?? `Meta refused the message (${response.status})`));
    return String(json.message_id ?? arr(json.messages)[0]?.id ?? '') || null;
}
