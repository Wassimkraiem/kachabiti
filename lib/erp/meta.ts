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
    attachments: MetaAttachment[];
    // A reply typed by a person in Meta Business Suite (an echo not sent by our app); senderId is
    // then the customer it went to.
    fromPage: boolean;
}

/** A photo, voice note… on a message: a URL (Messenger, Instagram) or a media id (WhatsApp). */
export interface MetaAttachment {
    type: 'image' | 'audio' | 'video' | 'file';
    url?: string;
    mediaId?: string;
}

type Json = Record<string, unknown>;
const arr = (v: unknown) => (Array.isArray(v) ? (v as Json[]) : []);
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Json) : {});
const ATTACHMENT_TYPES = ['image', 'audio', 'video', 'file'] as const;
const attachmentType = (type: unknown): MetaAttachment['type'] =>
    ATTACHMENT_TYPES.find((t) => t === type) ?? (type === 'voice' ? 'audio' : type === 'sticker' ? 'image' : 'file');

/**
 * Messages in a webhook payload, with their attachments. Echoes of what our app sent are skipped
 * (they are stored when sent); echoes from another app (Business Suite) are kept as fromPage.
 * Without META_APP_ID echoes can't be told apart, so all are skipped.
 */
export function parseWebhook(payload: Json): IncomingMessage[] {
    const out: IncomingMessage[] = [];
    const object = payload.object;
    const appId = process.env.META_APP_ID;
    for (const entry of arr(payload.entry)) {
        if (object === 'page' || object === 'instagram') {
            for (const event of arr(entry.messaging)) {
                const message = obj(event.message);
                if (!message.mid) continue;
                const fromPage = Boolean(message.is_echo);
                if (fromPage && (!appId || String(message.app_id ?? '') === appId)) continue;
                const attachments: MetaAttachment[] = arr(message.attachments)
                    .map((a) => ({ type: attachmentType(a.type), url: obj(a.payload).url as string | undefined }))
                    .filter((a) => typeof a.url === 'string');
                out.push({
                    channel: object === 'page' ? 'facebook' : 'instagram',
                    externalId: String(message.mid),
                    senderId: String(obj(fromPage ? event.recipient : event.sender).id ?? ''),
                    senderName: null,
                    phone: null,
                    text: typeof message.text === 'string' && message.text ? message.text : attachments.length ? `[${attachments.map((a) => a.type).join(', ')}]` : '[message]',
                    sentAt: new Date(Number(event.timestamp) || Date.now()),
                    attachments,
                    fromPage,
                });
            }
        } else if (object === 'whatsapp_business_account') {
            for (const change of arr(entry.changes)) {
                const value = obj(change.value);
                const names = new Map(arr(value.contacts).map((c) => [String(c.wa_id), String(obj(c.profile).name ?? '')]));
                for (const message of arr(value.messages)) {
                    const from = String(message.from ?? '');
                    const type = String(message.type ?? 'message');
                    const media = obj(message[type]);
                    const caption = typeof media.caption === 'string' ? media.caption : '';
                    const text = obj(message.text).body;
                    out.push({
                        channel: 'whatsapp',
                        externalId: String(message.id),
                        senderId: from,
                        senderName: names.get(from) || null,
                        phone: from,
                        text: typeof text === 'string' ? text : caption || `[${type}]`,
                        attachments: media.id && type !== 'text' ? [{ type: attachmentType(type === 'document' ? 'file' : type), mediaId: String(media.id) }] : [],
                        fromPage: false,
                        sentAt: new Date((Number(message.timestamp) || Date.now() / 1000) * 1000),
                    });
                }
            }
        }
    }
    return out.filter((m) => m.senderId);
}

/** Downloads an attachment (its Messenger URL expires, so this runs as soon as it arrives). */
export async function downloadMetaMedia(attachment: MetaAttachment): Promise<{ data: Buffer; mime: string }> {
    let url = attachment.url;
    let headers: Record<string, string> = {};
    if (attachment.mediaId) {
        // WhatsApp: the media id gives a short-lived URL that needs the token too.
        headers = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
        const info = await fetch(`${GRAPH}/${attachment.mediaId}`, { headers, signal: AbortSignal.timeout(15_000) });
        if (!info.ok) throw new Error(`WhatsApp media lookup failed (${info.status})`);
        url = String(((await info.json()) as Json).url ?? '');
    }
    if (!url) throw new Error('Attachment without a URL');
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Attachment download failed (${response.status})`);
    const data = Buffer.from(await response.arrayBuffer());
    // shortcut: 25 MB cap (Groq's audio limit), larger files are refused rather than streamed.
    if (data.length > 25 * 1024 * 1024) throw new Error('Attachment larger than 25 MB');
    return { data, mime: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' };
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
