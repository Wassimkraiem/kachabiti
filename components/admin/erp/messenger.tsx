"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Avatar, Badge, Button, Empty, Input, Space, Spin, Tag, Typography } from "antd";
import { ArrowLeftOutlined, ArrowRightOutlined, CheckOutlined, CommentOutlined, FacebookFilled, InstagramFilled, MessageOutlined, PhoneOutlined, SendOutlined, TikTokFilled, UndoOutlined, UserOutlined, WhatsAppOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { useAdminRole } from "@/lib/admin-role-context";
import { STAGE_COLORS, STAGE_LABELS, type CustomerStage } from "@/lib/erp/constants";
import { api, formatDate, useApi } from "./erp-client";
import { Attachments, MediaButtons, messageText } from "./messenger-media";

const { Text } = Typography;

/** How often the open lists and conversations look for something new. */
const REFRESH_MS = 10_000;

export const CHAT_CHANNELS: Record<string, { label: string; color: string; icon: ReactNode }> = {
    facebook: { label: "Facebook", color: "#1877f2", icon: <FacebookFilled /> },
    instagram: { label: "Instagram", color: "#d62976", icon: <InstagramFilled /> },
    whatsapp: { label: "WhatsApp", color: "#1fa855", icon: <WhatsAppOutlined /> },
    tiktok: { label: "TikTok", color: "#111111", icon: <TikTokFilled /> },
};

export interface MessageThread {
    customer_id: string;
    channel: string;
    direction: string;
    body: string;
    created_at: string;
    sender_name: string | null;
    unread: number;
    photo?: boolean;
    customer: { full_name: string; phone: string | null; stage: CustomerStage; assigned_to: string | null; assigned_to_email: string | null };
}

export interface CommentThread {
    platform: string;
    author: string;
    author_name: string | null;
    body: string;
    commented_at: string;
    phone: string | null;
    open: number;
}

interface ChatMessage {
    id: string;
    direction: "in" | "out" | "note";
    body: string;
    attachments?: { type: string }[];
    created_at: string;
    created_by_email: string | null;
}

interface ChatComment {
    id: string;
    body: string;
    commented_at: string;
    handled_at: string | null;
    handled_by_email: string | null;
    post_url: string | null;
    phone: string | null;
    customer: { id: string; full_name: string } | null;
    task: { id: string; done_at: string | null } | null;
}

/** Runs `reload` regularly while the tab is visible. */
export function usePolling(reload: () => void) {
    useEffect(() => {
        const timer = setInterval(() => {
            if (document.visibilityState === "visible") reload();
        }, REFRESH_MS);
        return () => clearInterval(timer);
    }, [reload]);
}

/** The name an agent goes by: their e-mail before the @. */
export const agentName = (email: string | null | undefined) => email?.split("@")[0] ?? "";

const timeOf = (value: string) => dayjs(value).format("HH:mm");

/** The address of a thread's profile photo. */
export const photoOf = (th: MessageThread) => (th.photo ? `/api/crm/media/photo?customer_id=${th.customer_id}&channel=${th.channel}` : undefined);

export function ChatAvatar({ name, channel, photo, size = 44 }: { name: string; channel: string; photo?: string; size?: number }) {
    const c = CHAT_CHANNELS[channel];
    return (
        <Badge
            offset={[-6, size - 8]}
            count={c ? <span title={c.label} style={{ background: "#fff", borderRadius: "50%", color: c.color, fontSize: 15, lineHeight: 1, padding: 1 }}>{c.icon}</span> : undefined}
        >
            <Avatar size={size} src={photo} alt="" icon={name ? undefined : <UserOutlined />} style={{ background: "#efe6dd", color: "#7a3b2e", fontWeight: 600 }}>
                {name ? [...name][0].toUpperCase() : null}
            </Avatar>
        </Badge>
    );
}

/** One line of the list: avatar, name, latest text, time and what's waiting. */
export function ThreadRow({ name, channel, photo, text, date, count, active, extra, onClick }: {
    name: string; channel: string; photo?: string; text: string; date: string; count: number; active: boolean; extra?: ReactNode; onClick: () => void;
}) {
    const { t, locale } = useAdminT();
    const d = dayjs(date);
    const when = d.isSame(dayjs(), "day") ? timeOf(date) : d.isSame(dayjs().subtract(1, "day"), "day") ? t("Yesterday") : formatDate(date, locale);
    return (
        <button type="button" className={`msgr-row${active ? " is-active" : ""}`} aria-current={active || undefined} onClick={onClick}>
            <ChatAvatar name={name} channel={channel} photo={photo} />
            <span className="msgr-row-main">
                <span className="msgr-row-line">
                    <span className="msgr-ellipsis" dir="auto" style={{ fontWeight: count ? 700 : 500 }}>{name || t("(no name)")}</span>
                    <Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{when}</Text>
                </span>
                <span className="msgr-row-line">
                    <span className="msgr-ellipsis" dir="auto" style={{ color: count ? "#1f1f1f" : "#6b6b6b", fontWeight: count ? 600 : 400, fontSize: 13 }}>{text}</span>
                    {count > 0 && <Badge count={count} size="small" color="#7a3b2e" />}
                </span>
                {extra}
            </span>
        </button>
    );
}

function ChatHeader({ name, channel, photo, sub, onBack, actions }: { name: string; channel: string; photo?: string; sub?: ReactNode; onBack: () => void; actions?: ReactNode }) {
    const { t, locale } = useAdminT();
    return (
        <div className="msgr-chat-head">
            <Button className="msgr-back" type="text" aria-label={t("Back")} icon={locale === "ar" ? <ArrowRightOutlined /> : <ArrowLeftOutlined />} onClick={onBack} />
            <ChatAvatar name={name} channel={channel} photo={photo} size={38} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div className="msgr-ellipsis" style={{ fontWeight: 600 }}><bdi>{name || t("(no name)")}</bdi></div>
                <div className="msgr-ellipsis" style={{ fontSize: 12, color: "#6b6b6b" }}>{CHAT_CHANNELS[channel]?.label ?? channel}{sub}</div>
            </div>
            <Space size={4}>{actions}</Space>
        </div>
    );
}

/** The scrolling part of a conversation, with a date above each day; stays at the bottom as messages arrive. */
function ChatBody<T extends { id: string }>({ items, dateOf, render, loading, empty }: {
    items: T[] | undefined; dateOf: (item: T) => string; render: (item: T) => ReactNode; loading: boolean; empty: string;
}) {
    const { t, locale } = useAdminT();
    const box = useRef<HTMLDivElement>(null);
    const last = items?.[items.length - 1]?.id;
    useEffect(() => {
        if (box.current) box.current.scrollTop = box.current.scrollHeight;
    }, [last]);
    return (
        <div ref={box} className="msgr-chat-body" role="log" aria-live="polite">
            {!items && loading && <Spin style={{ margin: "auto" }} />}
            {items?.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} style={{ margin: "auto" }} />}
            {items?.map((item, i) => {
                const date = dateOf(item);
                const newDay = i === 0 || !dayjs(date).isSame(dateOf(items[i - 1]), "day");
                return (
                    <div key={item.id} style={{ display: "contents" }}>
                        {newDay && <div className="msgr-day">{dayjs(date).isSame(dayjs(), "day") ? t("Today") : formatDate(date, locale)}</div>}
                        {render(item)}
                    </div>
                );
            })}
        </div>
    );
}

/** A conversation with one customer on one channel. Give it a `key` per thread: the draft is its own. */
export function MessageChat({ thread, connected, onBack, onChange }: { thread: MessageThread; connected: boolean; onBack: () => void; onChange: () => void }) {
    const { t } = useAdminT();
    const { customer_id, channel, customer } = thread;
    const { data, loading, error, reload } = useApi<ChatMessage[]>(`/api/crm/interactions?customer_id=${customer_id}&channel=${channel}`);
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const [busy, setBusy] = useState(false);
    const me = useAdminRole();
    usePolling(reload);

    // Who answers: the staff member who opens it first (owners and admins when they reply or take it).
    const owner = customer.assigned_to;
    const mine = !!me.id && owner === me.id;
    const canReply = !owner || mine || me.isAdmin;
    const assign = async (action: "claim" | "take" | "release") => {
        setBusy(true);
        try {
            await api("/api/crm/interactions/claim", { method: "POST", body: { customer_id, action } });
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setBusy(false);
            onChange();
        }
    };
    useEffect(() => {
        if (!owner && me.id && !me.isAdmin) void assign("claim");
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once per conversation, when nobody has it
    }, [owner, me.id, me.isAdmin]);

    // Opening a conversation, or receiving in the open one, marks it read.
    const unread = thread.unread;
    useEffect(() => {
        if (!unread) return;
        api("/api/crm/interactions", { method: "PUT", body: { customer_id, channel } }).then(onChange).catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange only refreshes the list
    }, [unread, customer_id, channel]);

    const send = async () => {
        const body = text.trim();
        if (!body || sending) return;
        setSending(true);
        try {
            await api("/api/crm/interactions", { method: "POST", body: { customer_id, channel, direction: "out", body, send: true } });
            setText("");
            await reload();
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            onChange(); // a reply also claims the conversation
            setSending(false);
        }
    };

    return (
        <>
            <ChatHeader
                name={customer.full_name || thread.sender_name || customer.phone || ""}
                channel={channel}
                photo={photoOf(thread)}
                sub={owner ? ` · ${mine ? t("Assigned to you") : t("Assigned to {name}", { name: agentName(customer.assigned_to_email) })}` : ""}
                onBack={onBack}
                actions={
                    <>
                        {mine && <Button size="small" loading={busy} onClick={() => assign("release")}>{t("Release")}</Button>}
                        {owner && !mine && me.isAdmin && <Button size="small" loading={busy} onClick={() => assign("take")}>{t("Take over")}</Button>}
                        <Tag className="msgr-wide" color={STAGE_COLORS[customer.stage]}>{t(STAGE_LABELS[customer.stage])}</Tag>
                        {customer.phone && <Button type="text" aria-label={t("Call")} title={customer.phone} icon={<PhoneOutlined />} href={`tel:+216${customer.phone}`} />}
                        <Link href={`/admin/customers/${customer_id}`}><Button icon={<UserOutlined />} aria-label={t("Customer record")}><span className="msgr-wide">{t("Customer record")}</span></Button></Link>
                    </>
                }
            />
            {error && <Text type="danger" style={{ padding: "8px 16px" }}>{t(error)}</Text>}
            <ChatBody
                items={data ?? undefined}
                loading={loading}
                empty={t("No messages yet.")}
                dateOf={(m) => m.created_at}
                render={(m) => (
                    <div className={`msgr-bubble is-${m.direction}`}>
                        <Attachments id={m.id} items={m.attachments} />
                        {!(m.attachments?.length && messageText(m.body, t) !== m.body) && <div dir="auto" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{messageText(m.body, t)}</div>}
                        <div className="msgr-meta">{m.direction !== "in" && m.created_by_email ? `${m.created_by_email} · ` : ""}{timeOf(m.created_at)}</div>
                    </div>
                )}
            />
            <div className="msgr-compose">
                {!canReply ? (
                    <Text type="secondary">{t("Assigned to {name}: only they can reply.", { name: agentName(customer.assigned_to_email) })}</Text>
                ) : connected ? (
                    <>
                        {(channel === "facebook" || channel === "instagram") && <MediaButtons customerId={customer_id} channel={channel} onSent={async () => { await reload(); onChange(); }} />}
                        <Input.TextArea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            onPressEnter={(e) => {
                                // Shift+Enter: new line. isComposing: Enter that picks a word in an input method.
                                if (e.shiftKey || e.nativeEvent.isComposing) return;
                                e.preventDefault();
                                send();
                            }}
                            autoSize={{ minRows: 1, maxRows: 5 }}
                            maxLength={2000}
                            placeholder={t("Write a message…")}
                            aria-label={t("Write a message…")}
                            dir="auto"
                            style={{ borderRadius: 20, padding: "8px 14px", flex: 1, minWidth: 0, width: "auto" }}
                        />
                        <Button type="primary" shape="circle" size="large" icon={<SendOutlined />} aria-label={t("Send")} loading={sending} disabled={!text.trim()} onClick={send} />
                    </>
                ) : (
                    <Text type="secondary">{t("This channel isn't connected, so replies can't be sent from here.")}</Text>
                )}
            </div>
        </>
    );
}

/** One person's public comments on one platform. Give it a `key` per thread. */
export function CommentChat({ thread, onBack, onChange }: { thread: CommentThread; onBack: () => void; onChange: () => void }) {
    const { t, locale } = useAdminT();
    const { platform, author } = thread;
    const { data, loading, error, reload } = useApi<{ rows: ChatComment[] }>(`/api/crm/comments?platform=${platform}&author=${encodeURIComponent(author)}&size=200`);
    const [busy, setBusy] = useState(false);
    usePolling(reload);

    const rows = data ? [...data.rows].reverse() : undefined;
    const open = (rows ?? []).filter((r) => !r.handled_at);
    const customer = (rows ?? []).find((r) => r.customer)?.customer;
    const setHandled = async (ids: string[], handled: boolean) => {
        setBusy(true);
        try {
            await api("/api/crm/comments", { method: "PATCH", body: { ids, handled } });
            await reload();
            onChange();
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <ChatHeader
                name={thread.author_name ?? ""}
                channel={platform}
                sub={thread.phone ? ` · ${thread.phone}` : ""}
                onBack={onBack}
                actions={
                    <>
                        {thread.phone && <Button type="text" aria-label={t("Call")} title={thread.phone} icon={<PhoneOutlined />} href={`tel:+216${thread.phone}`} />}
                        {customer && <Link href={`/admin/customers/${customer.id}`}><Button icon={<UserOutlined />} aria-label={t("Customer record")}><span className="msgr-wide">{t("Customer record")}</span></Button></Link>}
                    </>
                }
            />
            {error && <Text type="danger" style={{ padding: "8px 16px" }}>{t(error)}</Text>}
            <ChatBody
                items={rows}
                loading={loading}
                empty={t("No comments yet.")}
                dateOf={(c) => c.commented_at}
                render={(c) => (
                    <div className="msgr-bubble is-in">
                        <div dir="auto" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.body || "—"}</div>
                        <div className="msgr-meta">
                            <span>{timeOf(c.commented_at)}</span>
                            {c.post_url && <a href={c.post_url} target="_blank" rel="noopener noreferrer">{t("View post")}</a>}
                            {c.task && <Tag color={c.task.done_at ? "green" : "orange"} style={{ margin: 0 }}>{t("Call back")}: {t(c.task.done_at ? "Done" : "To call")}</Tag>}
                            {c.handled_at
                                ? <Button size="small" type="text" icon={<UndoOutlined />} disabled={busy} title={[c.handled_by_email, formatDate(c.handled_at, locale, true)].filter(Boolean).join(" · ")} onClick={() => setHandled([c.id], false)}>{t("Handled")}</Button>
                                : <Button size="small" type="link" icon={<CheckOutlined />} disabled={busy} onClick={() => setHandled([c.id], true)}>{t("Mark handled")}</Button>}
                        </div>
                    </div>
                )}
            />
            <div className="msgr-compose" style={{ justifyContent: "space-between" }}>
                <Text type="secondary">{t("{count} comment(s) to handle", { count: open.length })}</Text>
                <Button type="primary" icon={<CheckOutlined />} disabled={!open.length} loading={busy} onClick={() => setHandled(open.map((c) => c.id), true)}>{t("Mark all handled")}</Button>
            </div>
        </>
    );
}

/** The side tabs: Messages or Comments, then the channels. */
export function MessengerRail({ tab, onTab, channel, onChannel, counts, totals }: {
    tab: "messages" | "comments"; onTab: (tab: "messages" | "comments") => void;
    channel: string; onChannel: (channel: string) => void;
    /** What's waiting in the open tab, per channel. */
    counts: Record<string, number>;
    totals: { messages: number; comments: number };
}) {
    const { t } = useAdminT();
    const item = (key: string, label: string, icon: ReactNode, count: number, active: boolean, onClick: () => void) => (
        <button key={key} type="button" className={`msgr-tab${active ? " is-active" : ""}`} aria-pressed={active} onClick={onClick}>
            {icon}
            <span>{label}</span>
            {count > 0 && <Badge count={count} size="small" color="#7a3b2e" />}
        </button>
    );
    const channels = Object.entries(CHAT_CHANNELS).filter(([key]) => tab === "messages" || key !== "whatsapp");
    return (
        <nav className="msgr-rail" aria-label={t("Messenger")}>
            <div className="msgr-rail-group">
                {item("messages", t("Messages"), <MessageOutlined />, totals.messages, tab === "messages", () => onTab("messages"))}
                {item("comments", t("Comments"), <CommentOutlined />, totals.comments, tab === "comments", () => onTab("comments"))}
            </div>
            <div className="msgr-rail-title">{t("Channel")}</div>
            <div className="msgr-rail-group">
                {item("", t("All channels"), null, 0, channel === "", () => onChannel(""))}
                {channels.map(([key, c]) => item(key, key === "facebook" && tab === "messages" ? "Messenger" : c.label, <span style={{ color: c.color }}>{c.icon}</span>, counts[key] ?? 0, channel === key, () => onChannel(key)))}
            </div>
        </nav>
    );
}

export const MESSENGER_CSS = `
.msgr { display: flex; height: calc(100dvh - 250px); min-height: 440px; background: #fff; border: 1px solid #ececec; border-radius: 12px; overflow: hidden; }
.msgr-rail { width: 190px; flex: none; padding: 12px 8px; border-inline-end: 1px solid #ececec; background: #faf8f6; overflow-y: auto; }
.msgr-rail-group { display: flex; flex-direction: column; gap: 2px; }
.msgr-rail-title { margin: 18px 12px 6px; font-size: 12px; color: #6b6b6b; }
.msgr button.msgr-tab, .msgr button.msgr-row { border: 0; background: none; font: inherit; color: inherit; cursor: pointer; text-align: start; }
.msgr button.msgr-tab { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 12px; border-radius: 8px; white-space: nowrap; }
.msgr button.msgr-tab > span:nth-last-child(1) { margin-inline-end: 0; }
.msgr button.msgr-tab .ant-badge { margin-inline-start: auto; }
.msgr button.msgr-tab:hover, .msgr button.msgr-row:hover { background: #f3eee9; }
.msgr button.msgr-tab.is-active, .msgr button.msgr-row.is-active { background: #efe3da; }
.msgr button.msgr-tab.is-active { font-weight: 600; color: #7a3b2e; }
.msgr button.msgr-tab:focus-visible, .msgr button.msgr-row:focus-visible { outline: 2px solid #7a3b2e; outline-offset: -2px; }
.msgr-list { width: 330px; flex: none; display: flex; flex-direction: column; border-inline-end: 1px solid #ececec; min-height: 0; }
.msgr-list-head { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.msgr-list-rows { flex: 1; overflow-y: auto; min-height: 0; padding: 0 6px 8px; }
.msgr button.msgr-row { display: flex; gap: 12px; align-items: center; width: 100%; padding: 10px; border-radius: 10px; }
.msgr-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.msgr-row-line { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 0; }
.msgr-ellipsis { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msgr-chat { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.msgr-chat-head { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid #ececec; }
.msgr-back { display: none; }
.msgr-chat-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 16px; }
.msgr-day { align-self: center; margin: 10px 0 4px; font-size: 12px; color: #6b6b6b; }
.msgr-bubble { max-width: min(75%, 520px); padding: 8px 12px; border-radius: 18px; align-self: flex-start; background: #f0f0f0; border-end-start-radius: 4px; }
.msgr-bubble.is-out { align-self: flex-end; background: #7a3b2e; color: #fff; border-radius: 18px; border-end-end-radius: 4px; }
.msgr-bubble .ant-image, .msgr-bubble .ant-image-img { max-width: 100%; }
.msgr-bubble.is-note { align-self: center; background: #fff7e0; border-radius: 10px; font-size: 13px; }
.msgr-meta { margin-top: 2px; font-size: 11px; color: #6b6b6b; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.msgr-bubble.is-out .msgr-meta { color: rgba(255,255,255,.8); justify-content: flex-end; }
.msgr-compose { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: flex-end; padding: 12px 16px; border-top: 1px solid #ececec; }
@media (max-width: 1199px) {
  .msgr-rail { width: 150px; }
  .msgr-list { width: 270px; }
  .msgr-chat .msgr-wide { display: none; }
}
@media (max-width: 899px) {
  .msgr { flex-direction: column; height: calc(100dvh - 224px); }
  .msgr-rail { width: auto; padding: 8px; border-inline-end: 0; border-bottom: 1px solid #ececec; overflow: visible; }
  .msgr-rail-title { display: none; }
  .msgr-rail-group { flex-direction: row; overflow-x: auto; }
  .msgr-rail-group + .msgr-rail-title + .msgr-rail-group { margin-top: 6px; }
  .msgr-rail-group:first-child button.msgr-tab { flex: 1; justify-content: center; }
  .msgr-rail-group:first-child button.msgr-tab .ant-badge { margin-inline-start: 0; }
  .msgr-list { width: auto; flex: 1; border-inline-end: 0; }
  .msgr-chat { display: none; }
  .msgr-back { display: inline-flex; }
  .msgr.has-open .msgr-rail, .msgr.has-open .msgr-list { display: none; }
  .msgr.has-open .msgr-chat { display: flex; }
}
`;
