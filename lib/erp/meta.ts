import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Messenger, Instagram Direct and WhatsApp Cloud API (Meta). Optional: without the tokens the
 * CRM works by hand (conversations typed in by agents), and nothing here is called.
 *
 *   META_APP_SECRET           verifies webhook signatures (X-Hub-Signature-256)
 *   META_VERIFY_TOKEN         the token entered when subscribing the webhook in Meta's dashboard
 *   META_PAGE_ACCESS_TOKEN    replies on Messenger and Instagram when no Page is connected in the
 *                             admin (api/src/crm/meta-connection.controller.ts, which needs
 *                             META_APP_ID and META_LOGIN_CONFIG_ID)
 *   WHATSAPP_TOKEN            replies on WhatsApp
 *   WHATSAPP_PHONE_NUMBER_ID  the WhatsApp Business number that sends them
 *
 * Meta only lets a business reply freely within 24 hours of the customer's last message
 * (WhatsApp needs an approved template after that); the Graph API returns an error otherwise.
 */

export const META_VERSION = 'v24.0';
// META_GRAPH_URL: a stand-in for the e2e suite.
const GRAPH = process.env.META_GRAPH_URL || `https://graph.facebook.com/${META_VERSION}`;

export type MetaChannel = 'facebook' | 'instagram' | 'whatsapp';

export const metaConfigured = (pageToken: string | null) => ({
    webhook: Boolean(process.env.META_APP_SECRET && process.env.META_VERIFY_TOKEN),
    facebook: Boolean(pageToken),
    instagram: Boolean(pageToken),
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
    direction: 'in' | 'out'; // out: sent by the shop, from Messenger, Instagram or Business Suite too
    externalId: string;      // message id (dedupes Meta's retries)
    senderId: string;        // the customer: PSID / IGSID / WhatsApp number
    senderName: string | null;
    phone: string | null;    // WhatsApp only
    text: string;
    attachments: { type: string; url: string }[]; // Meta's links, which expire
    sentAt: Date;
}

type Json = Record<string, unknown>;
const arr = (v: unknown) => (Array.isArray(v) ? (v as Json[]) : []);
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Json) : {});

/** True for a link to Meta's file servers (or to the e2e suite's stand-in). */
export function metaFile(link: string): boolean {
    try {
        const url = new URL(link);
        if (process.env.META_GRAPH_URL && url.origin === new URL(process.env.META_GRAPH_URL).origin) return true;
        return url.protocol === 'https:' && /\.(fbcdn\.net|fbsbx\.com|cdninstagram\.com)$/.test(url.hostname);
    } catch {
        return false;
    }
}

/** Messages in a webhook payload (text, and the files that come with it), the shop's own included. */
export function parseWebhook(payload: Json): IncomingMessage[] {
    const out: IncomingMessage[] = [];
    const object = payload.object;
    for (const entry of arr(payload.entry)) {
        if (object === 'page' || object === 'instagram') {
            // The test button in Meta's dashboard sends Instagram messages as changes.
            const tests = arr(entry.changes).filter((c) => c.field === 'messages').map((c) => obj(c.value));
            for (const event of [...arr(entry.messaging), ...tests]) {
                const message = obj(event.message);
                if (!message.mid) continue;
                const attachments = arr(message.attachments);
                out.push({
                    channel: object === 'page' ? 'facebook' : 'instagram',
                    direction: message.is_echo ? 'out' : 'in',
                    externalId: String(message.mid),
                    senderId: String(obj(message.is_echo ? event.recipient : event.sender).id ?? ''),
                    senderName: null,
                    phone: null,
                    text: typeof message.text === 'string' && message.text ? message.text : attachments.length ? `[${attachments.map((a) => a.type).join(', ')}]` : '[message]',
                    attachments: attachments
                        .map((a) => ({ type: String(a.type), url: String(obj(a.payload).url ?? '') }))
                        .filter((a) => metaFile(a.url)),
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
                        direction: 'in',
                        externalId: String(message.id),
                        senderId: from,
                        senderName: names.get(from) || null,
                        phone: from,
                        text: typeof text === 'string' ? text : `[${String(message.type ?? 'message')}]`,
                        attachments: [], // shortcut: WhatsApp files need its media API, add it when WhatsApp is connected
                        sentAt: new Date((Number(message.timestamp) || Date.now() / 1000) * 1000),
                    });
                }
            }
        }
    }
    return out.filter((m) => m.senderId);
}

export interface AdReferral {
    channel: 'facebook' | 'instagram';
    senderId: string;        // the customer
    adId: string;
    source: string | null;   // ADS
    ref: string | null;
    title: string | null;    // the ad's title, when Meta gives it
    externalId: string;      // the message id, or sender:time
    at: Date;
}

/**
 * Which ad started a conversation (Click to Messenger / Instagram Direct ads): Meta puts a referral on
 * the first message, or sends it alone (Page field messaging_referrals) when the thread already existed.
 */
export function parseReferrals(payload: Json): AdReferral[] {
    const out: AdReferral[] = [];
    const object = payload.object;
    if (object !== 'page' && object !== 'instagram') return out;
    for (const entry of arr(payload.entry)) {
        const tests = arr(entry.changes).filter((c) => c.field === 'messages').map((c) => obj(c.value));
        for (const event of [...arr(entry.messaging), ...tests]) {
            const message = obj(event.message);
            if (message.is_echo) continue;
            const referral = obj(event.referral ?? message.referral ?? obj(event.postback).referral);
            const adId = referral.ad_id ? String(referral.ad_id) : '';
            const senderId = String(obj(event.sender).id ?? '');
            if (!adId || !senderId) continue;
            const context = obj(referral.ads_context_data);
            const at = new Date(Number(event.timestamp) || Date.now());
            out.push({
                channel: object === 'page' ? 'facebook' : 'instagram',
                senderId,
                adId,
                source: referral.source ? String(referral.source) : null,
                ref: referral.ref ? String(referral.ref) : null,
                title: typeof context.ad_title === 'string' ? context.ad_title : null,
                externalId: message.mid ? String(message.mid) : `${senderId}:${at.getTime()}`,
                at,
            });
        }
    }
    return out;
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

/** Calls the Graph API (JSON). Throws with Meta's message when it refuses. */
export async function graph<T = Json>(path: string, init: { method?: string; token?: string; body?: Json; timeout?: number } = {}): Promise<T> {
    const response = await fetch(`${GRAPH}${path}`, {
        method: init.method ?? 'GET',
        headers: {
            ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(init.timeout ?? 15_000),
    });
    const json = (await response.json().catch(() => ({}))) as Json;
    if (!response.ok) throw new Error(String(obj(json.error).message ?? `Meta refused the message (${response.status})`));
    return json as T;
}

/** Sends a photo or audio on Messenger or Instagram; Meta reads it at `url`. */
export async function sendMetaFile(recipientId: string, type: 'image' | 'audio', url: string, token: string): Promise<string | null> {
    const body = { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { attachment: { type, payload: { url } } } };
    const json = await graph('/me/messages', { method: 'POST', token, body, timeout: 60_000 });
    return String(json.message_id ?? '') || null;
}

/** Sends a text reply. Throws with Meta's message when it refuses. */
export async function sendMetaText(channel: MetaChannel, recipientId: string, text: string, pageToken: string | null): Promise<string | null> {
    let path: string;
    let body: Json;
    let token: string | null | undefined;
    if (channel === 'whatsapp') {
        token = process.env.WHATSAPP_TOKEN;
        path = `/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
        body = { messaging_product: 'whatsapp', to: recipientId, type: 'text', text: { body: text } };
    } else {
        token = pageToken;
        path = '/me/messages';
        body = { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text } };
    }
    if (!token) throw new Error(`${channel} is not connected`);
    const json = await graph(path, { method: 'POST', token, body });
    return String(json.message_id ?? arr(json.messages)[0]?.id ?? '') || null;
}
