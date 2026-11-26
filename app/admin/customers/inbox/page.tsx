"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Button, Empty, Input, Modal, Segmented, Space, Spin, Tag, Typography } from "antd";
import { LinkOutlined, MessageOutlined, SearchOutlined } from "@ant-design/icons";
import { useAdminT } from "@/lib/admin-i18n";
import { useAdminRole } from "@/lib/admin-role-context";
import { PageHeader } from "@/components/admin/erp/ui";
import { useApi } from "@/components/admin/erp/erp-client";
import MetaCheck from "@/components/admin/erp/MetaCheck";
import MetaConnection from "@/components/admin/erp/MetaConnection";
import { messageText } from "@/components/admin/erp/messenger-media";
import { agentName, CHAT_CHANNELS, CommentChat, photoOf, MESSENGER_CSS, MessageChat, MessengerRail, type MessengerTab, ThreadRow, usePolling, type CommentThread, type MessageThread } from "@/components/admin/erp/messenger";

const { Text } = Typography;

type Connected = Record<"webhook" | "facebook" | "instagram" | "whatsapp", boolean>;
const sum = (counts: Record<string, number> | undefined) => Object.values(counts ?? {}).reduce((a, b) => a + b, 0);
const messageKey = (th: MessageThread) => `${th.customer_id}:${th.channel}`;
const commentKey = (th: CommentThread) => `${th.platform}:${th.author}`;

/**
 * Admin → Messenger: conversations (Messenger, Instagram, WhatsApp) and public comments, side by
 * side like a chat app. They arrive through Meta's webhook; the CRM works by hand without it.
 */
function Messenger() {
    const { t } = useAdminT();
    const me = useAdminRole();
    const { isAdmin } = me;
    const params = useSearchParams();
    const asked = params.get("tab");
    const [tab, setTab] = useState<MessengerTab>(asked === "comments" || asked === "mine" ? asked : "messages");
    const chats = tab !== "comments"; // Messages, or those of the customers assigned to me
    const [channel, setChannel] = useState("");
    // Messages first show the conversations nobody has taken yet.
    const [show, setShow] = useState(tab === "messages" ? "none" : "all");
    const [search, setSearch] = useState("");
    const [query, setQuery] = useState("");
    // The open thread is kept whole: it stays open when a filter drops it from the list.
    const [openMessage, setOpenMessage] = useState<MessageThread | null>(null);
    const [openComment, setOpenComment] = useState<CommentThread | null>(null);
    // Back from Facebook's sign-in (?meta=…): MetaConnection carries on in the dialog.
    const [settings, setSettings] = useState(params.has("meta"));

    const filters = new URLSearchParams();
    if (query) filters.set("q", query);
    const messageFilters = new URLSearchParams(filters);
    const commentFilters = new URLSearchParams(filters);
    if (chats) {
        if (channel) messageFilters.set("channel", channel);
        if (show === "unread") messageFilters.set("unread", "1");
        if (tab === "mine") messageFilters.set("assigned", "me");
        // Unread, in Messages, is what waits for someone too.
        else if (show === "none" || show === "unread") messageFilters.set("assigned", "none");
        else if (show === "others") messageFilters.set("assigned", "others");
    } else {
        if (channel) commentFilters.set("platform", channel);
        commentFilters.set("show", show);
    }
    // Both load, for the counts on the two tabs.
    const messages = useApi<{ threads: MessageThread[]; unread: Record<string, number>; mine: number; connected: Connected }>(`/api/crm/interactions?inbox=1&${messageFilters}`);
    const comments = useApi<{ threads: CommentThread[]; open: Record<string, number> }>(`/api/crm/comments?threads=1&${commentFilters}`);
    usePolling(messages.reload);
    usePolling(comments.reload);

    const connected = messages.data?.connected;
    const list = chats ? messages : comments;
    const count = list.data?.threads.length;
    const message = openMessage && (messages.data?.threads.find((th) => messageKey(th) === messageKey(openMessage)) ?? openMessage);
    const comment = openComment && (comments.data?.threads.find((th) => commentKey(th) === commentKey(openComment)) ?? openComment);
    const hasOpen = chats ? !!message : !!comment;

    return (
        <div>
            <style>{MESSENGER_CSS}</style>
            <PageHeader
                title={t("Messenger")}
                crumbs={[{ title: t("Customers"), href: "/admin/customers" }]}
                extra={isAdmin && <Button icon={<LinkOutlined />} onClick={() => setSettings(true)}>{t("Connections")}</Button>}
            />
            {connected && !connected.webhook && (
                <Alert type="info" showIcon style={{ marginBottom: 16 }} title={t("The messaging channels are not connected yet.")} />
            )}
            <div className={`msgr${hasOpen ? " has-open" : ""}`}>
                <MessengerRail
                    tab={tab}
                    onTab={(next) => { setTab(next); setChannel(""); setShow(next === "messages" ? "none" : "all"); setSearch(""); setQuery(""); }}
                    channel={channel}
                    onChannel={setChannel}
                    counts={(chats ? messages.data?.unread : comments.data?.open) ?? {}}
                    totals={{ messages: sum(messages.data?.unread), mine: messages.data?.mine ?? 0, comments: sum(comments.data?.open) }}
                />
                <div className="msgr-list">
                    <div className="msgr-list-head">
                        <Input
                            allowClear
                            prefix={<SearchOutlined style={{ color: "#8c8c8c" }} />}
                            placeholder={t(chats ? "Name, phone or message" : "Comment, name or phone")}
                            aria-label={t("Search")}
                            value={search}
                            onChange={(e) => { setSearch(e.target.value); if (!e.target.value) setQuery(""); }}
                            onPressEnter={() => setQuery(search.trim())}
                        />
                        <Segmented
                            block
                            size="small"
                            value={show}
                            onChange={setShow}
                            options={tab === "messages"
                                ? [{ value: "none", label: t("To take") }, { value: "unread", label: t("Unread") }, { value: "others", label: t("Assigned") }, { value: "all", label: t("All") }]
                                : chats
                                ? [{ value: "all", label: t("All") }, { value: "unread", label: t("Unread") }]
                                : [{ value: "all", label: t("All") }, { value: "open", label: t("To handle") }, { value: "leads", label: t("Phone") }]}
                        />
                    </div>
                    <div className="msgr-list-rows">
                        {list.error && <Text type="danger">{t(list.error)}</Text>}
                        {!list.data && list.loading && <div style={{ textAlign: "center", padding: 24 }}><Spin /></div>}
                        {count === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(tab === "mine" ? "No conversation is assigned to you." : chats ? "No messages yet." : "No comments yet.")} />}
                        {chats
                            ? messages.data?.threads.map((th) => (
                                <ThreadRow
                                    key={messageKey(th)}
                                    name={th.customer.full_name || th.sender_name || th.customer.phone || ""}
                                    channel={th.channel}
                                    photo={photoOf(th)}
                                    text={`${th.direction === "out" ? `${t("You")}: ` : ""}${messageText(th.body, t)}`}
                                    date={th.created_at}
                                    count={th.unread}
                                    extra={(th.customer.assigned_to_email || th.ad) && <span className="msgr-ellipsis" style={{ display: "flex", gap: 6, alignItems: "center" }}>{th.ad && <Tag color="blue" style={{ margin: 0, fontSize: 11 }} title={th.ad}>{t("Ad")}</Tag>}{th.customer.assigned_to_email && <span className="msgr-ellipsis" style={{ fontSize: 12, color: "#7a3b2e" }}>{th.customer.assigned_to === me.id ? t("Assigned to you") : t("Assigned to {name}", { name: agentName(th.customer.assigned_to_email) })}</span>}</span>}
                                    active={!!message && messageKey(message) === messageKey(th)}
                                    onClick={() => setOpenMessage(th)}
                                />
                            ))
                            : comments.data?.threads.map((th) => (
                                <ThreadRow
                                    key={commentKey(th)}
                                    name={th.author_name ?? ""}
                                    channel={th.platform}
                                    text={th.body || "—"}
                                    date={th.commented_at}
                                    count={th.open}
                                    active={!!comment && commentKey(comment) === commentKey(th)}
                                    onClick={() => setOpenComment(th)}
                                />
                            ))}
                    </div>
                </div>
                <div className="msgr-chat">
                    {chats && message ? (
                        <MessageChat
                            key={messageKey(message)}
                            thread={message}
                            connected={!!connected?.[message.channel as keyof Connected]}
                            onBack={() => setOpenMessage(null)}
                            onChange={messages.reload}
                        />
                    ) : tab === "comments" && comment ? (
                        <CommentChat key={commentKey(comment)} thread={comment} onBack={() => setOpenComment(null)} onChange={comments.reload} />
                    ) : (
                        <Empty style={{ margin: "auto" }} image={<MessageOutlined style={{ fontSize: 48, color: "#c9bdb2" }} />} styles={{ image: { height: 56 } }} description={t("Choose a conversation")} />
                    )}
                </div>
            </div>
            <Modal title={t("Connections")} open={settings} onCancel={() => setSettings(false)} footer={null}>
                <Space wrap style={{ marginBottom: 12 }}>
                    {(["facebook", "instagram", "whatsapp"] as const).map((ch) => (
                        <Tag key={ch} color={connected?.[ch] && connected.webhook ? "green" : "default"}>
                            {CHAT_CHANNELS[ch].label}: {connected?.[ch] && connected.webhook ? t("Connected") : t("Not connected")}
                        </Tag>
                    ))}
                </Space>
                {connected && !connected.webhook && (
                    <p><Text type="secondary">{t("Connecting them needs a Meta business app (Messenger and Instagram) and a WhatsApp Business Cloud API number, with their tokens set on the server. Until then, log calls and messages on each customer's record.")}</Text></p>
                )}
                {isAdmin && <MetaConnection onChange={messages.reload} />}
                {isAdmin && <MetaCheck />}
            </Modal>
        </div>
    );
}

/** The Suspense boundary is for useSearchParams. */
export default function MessengerPage() {
    return <Suspense><Messenger /></Suspense>;
}
