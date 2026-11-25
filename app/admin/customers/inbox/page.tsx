"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, Empty, Segmented, Space, Spin, Tag, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useAdminT } from "@/lib/admin-i18n";
import { useAdminRole } from "@/lib/admin-role-context";
import { STAGE_COLORS, STAGE_LABELS, type CustomerStage } from "@/lib/erp/constants";
import { ChannelTag, ListRow, PageHeader } from "@/components/admin/erp/ui";
import { formatDate, useApi } from "@/components/admin/erp/erp-client";
import MetaConnection from "@/components/admin/erp/MetaConnection";

const { Text } = Typography;

interface Thread {
    customer_id: string;
    channel: string;
    direction: string;
    body: string;
    created_at: string;
    sender_name: string | null;
    unread: number;
    customer: { full_name: string; phone: string | null; stage: CustomerStage; assigned_to_email: string | null } | null;
}

/**
 * Admin → Inbox: the latest Messenger, Instagram and WhatsApp conversations in one list, unread
 * first. Messages arrive through Meta's webhook when the channels are connected; the CRM keeps
 * working by hand when they aren't.
 */
export default function InboxPage() {
    const { t, locale } = useAdminT();
    const { isAdmin } = useAdminRole();
    const [filter, setFilter] = useState<"all" | "unread">("all");
    const { data, loading, reload } = useApi<{ threads: Thread[]; connected: Record<string, boolean> }>(`/api/crm/interactions?inbox=1${filter === "unread" ? "&unread=1" : ""}`);
    const connected = data?.connected;
    const none = connected && !connected.webhook;

    return (
        <div>
            <PageHeader
                title={t("Inbox")}
                subtitle={t("Messages from Facebook, Instagram and WhatsApp, in one place.")}
                crumbs={[{ title: t("Customers"), href: "/admin/customers" }]}
                extra={<Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>{t("Refresh")}</Button>}
            />
            {isAdmin && <MetaConnection onChange={reload} />}
            {connected && (
                <Space wrap style={{ marginBottom: 12 }}>
                    {(["facebook", "instagram", "whatsapp"] as const).map((ch) => (
                        <Tag key={ch} color={connected[ch] && connected.webhook ? "green" : "default"}>
                            <ChannelTag channel={ch} /> {connected[ch] && connected.webhook ? t("Connected") : t("Not connected")}
                        </Tag>
                    ))}
                </Space>
            )}
            {none && (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    title={t("The messaging channels are not connected yet.")}
                    description={t("Connecting them needs a Meta business app (Messenger and Instagram) and a WhatsApp Business Cloud API number, with their tokens set on the server. Until then, log calls and messages on each customer's record.")}
                />
            )}
            <Card>
                <Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: t("All") }, { value: "unread", label: t("Unread") }]} style={{ marginBottom: 12 }} />
                {!data?.threads.length && !loading ? <Empty description={t("No messages yet.")} /> : (
                    <Spin spinning={loading}>
                        {(data?.threads ?? []).map((thread) => (
                            <ListRow
                                key={thread.customer_id}
                                extra={<Text type="secondary" style={{ fontSize: 12 }}>{formatDate(thread.created_at, locale, true)}</Text>}
                                avatar={<Badge count={thread.unread} size="small"><ChannelTag channel={thread.channel} /></Badge>}
                                title={
                                    <Space wrap>
                                        <Link href={`/admin/customers/${thread.customer_id}`} style={{ fontWeight: thread.unread ? 600 : 400 }}>
                                            {thread.customer?.full_name || thread.sender_name || thread.customer?.phone || t("(no name)")}
                                        </Link>
                                        {thread.customer && <Tag color={STAGE_COLORS[thread.customer.stage]}>{t(STAGE_LABELS[thread.customer.stage])}</Tag>}
                                        {thread.customer?.assigned_to_email && <Text type="secondary" style={{ fontSize: 12 }}>{thread.customer.assigned_to_email}</Text>}
                                    </Space>
                                }
                                description={<Text ellipsis style={{ maxWidth: 640 }}>{thread.direction === "out" ? `${t("You")}: ` : ""}{thread.body}</Text>}
                            />
                        ))}
                    </Spin>
                )}
            </Card>
        </div>
    );
}
