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
import { CHAT_CHANNELS, CommentChat, photoOf, MESSENGER_CSS, MessageChat, MessengerRail, ThreadRow, usePolling, type CommentThread, type MessageThread } from "@/components/admin/erp/messenger";

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
    const { isAdmin } = useAdminRole();
    const params = useSearchParams();
    const [tab, setTab] = useState<"messages" | "comments">(params.get("tab") === "comments" ? "comments" : "messages");
    const [channel, setChannel] = useState("");
    const [show, setShow] = useState("all");
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
    if (tab === "messages") {
        if (channel) messageFilters.set("channel", channel);
        if (show === "unread") messageFilters.set("unread", "1");
    } else {
        if (channel) commentFilters.set("platform", channel);
        commentFilters.set("show", show);
    }
    // Both load, for the counts on the two tabs.
    const messages = useApi<{ threads: MessageThread[]; unread: Record<string, number>; connected: Connected }>(`/api/crm/interactions?inbox=1&${messageFilters}`);
    const comments = useApi<{ threads: CommentThread[]; open: Record<string, number> }>(`/api/crm/comments?threads=1&${commentFilters}`);
    usePolling(messages.reload);
    usePolling(comments.reload);

    const connected = messages.data?.connected;
    const list = tab === "messages" ? messages : comments;
    const count = list.data?.threads.length;
    const message = openMessage && (messages.data?.threads.find((th) => messageKey(th) === messageKey(openMessage)) ?? openMessage);
    const comment = openComment && (comments.data?.threads.find((th) => commentKey(th) === commentKey(openComment)) ?? openComment);
    const hasOpen = tab === "messages" ? !!message : !!comment;

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
                    onTab={(next) => { setTab(next); setChannel(""); setShow("all"); setSearch(""); setQuery(""); }}
                    channel={channel}
                    onChannel={setChannel}
                    counts={(tab === "messages" ? messages.data?.unread : comments.data?.open) ?? {}}
                    totals={{ messages: sum(messages.data?.unread), comments: sum(comments.data?.open) }}
                />
                <div className="msgr-list">
                    <div className="msgr-list-head">
                        <Input
                            allowClear
                            prefix={<SearchOutlined style={{ color: "#8c8c8c" }} />}
                            placeholder={t(tab === "messages" ? "Name, phone or message" : "Comment, name or phone")}
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
                                ? [{ value: "all", label: t("All") }, { value: "unread", label: t("Unread") }]
                                : [{ value: "all", label: t("All") }, { value: "open", label: t("To handle") }, { value: "leads", label: t("Phone") }]}
                        />
                    </div>
                    <div className="msgr-list-rows">
                        {list.error && <Text type="danger">{t(list.error)}</Text>}
                        {!list.data && list.loading && <div style={{ textAlign: "center", padding: 24 }}><Spin /></div>}
                        {count === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(tab === "messages" ? "No messages yet." : "No comments yet.")} />}
                        {tab === "messages"
                            ? messages.data?.threads.map((th) => (
                                <ThreadRow
                                    key={messageKey(th)}
                                    name={th.customer.full_name || th.sender_name || th.customer.phone || ""}
                                    channel={th.channel}
                                    photo={photoOf(th)}
                                    text={`${th.direction === "out" ? `${t("You")}: ` : ""}${messageText(th.body, t)}`}
                                    date={th.created_at}
                                    count={th.unread}
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
                    {tab === "messages" && message ? (
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
