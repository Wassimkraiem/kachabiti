"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Input, Segmented, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import { CheckOutlined, PhoneOutlined, SearchOutlined, UndoOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { ChannelTag, PageHeader } from "@/components/admin/erp/ui";
import { api, formatDate, useApi } from "@/components/admin/erp/erp-client";

const { Text, Paragraph } = Typography;

interface CommentRow {
    id: string;
    platform: string;
    author_name: string | null;
    body: string;
    phone: string | null;
    commented_at: string;
    handled_at: string | null;
    handled_by_email: string | null;
    customer: { id: string; full_name: string; assigned_to_email: string | null } | null;
    task: { id: string; done_at: string | null } | null;
}

interface CommentList {
    rows: CommentRow[];
    total: number;
    leads: number;
    open: number;
    connected: { webhook: boolean; facebook: boolean; instagram: boolean };
}

/**
 * Admin → Customers → Comments: public comments on the shop's Facebook and Instagram posts
 * (Meta's webhook). A comment with a Tunisian phone number is a lead: the database links it to its
 * customer, opens a "call back" task and notifies the team (social_comment_lead).
 */
export default function CommentsPage() {
    const { t, locale } = useAdminT();
    const [show, setShow] = useState<"all" | "leads" | "open">("leads");
    const [platform, setPlatform] = useState("");
    const [search, setSearch] = useState("");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState<string[]>([]);

    const url = useMemo(() => {
        const qs = new URLSearchParams({ show, page: String(page) });
        if (platform) qs.set("platform", platform);
        if (query) qs.set("q", query);
        return `/api/crm/comments?${qs}`;
    }, [show, platform, query, page]);
    const { data, loading, reload } = useApi<CommentList>(url);

    const setHandled = async (ids: string[], handled: boolean) => {
        try {
            await api("/api/crm/comments", { method: "PATCH", body: { ids, handled } });
            setSelected([]);
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    return (
        <div>
            <PageHeader
                title={t("Comments")}
                subtitle={t("Comments on your Facebook and Instagram posts. A comment with a phone number becomes a customer to call back.")}
                crumbs={[{ title: t("Customers"), href: "/admin/customers" }]}
            />
            {data && !data.connected.webhook && (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    title={t("Facebook and Instagram aren't connected yet")}
                    description={t("Comments arrive once the Meta app is connected: set META_APP_SECRET and META_VERIFY_TOKEN on the server and subscribe the webhook (see docs/META.md).")}
                />
            )}
            <Card>
                <Space wrap style={{ marginBottom: 16 }}>
                    <Segmented
                        value={show}
                        onChange={(v) => { setShow(v as typeof show); setPage(1); }}
                        options={[
                            { value: "leads", label: `${t("With a phone number")} (${data?.leads ?? 0})` },
                            { value: "open", label: `${t("To handle")} (${data?.open ?? 0})` },
                            { value: "all", label: t("All") },
                        ]}
                    />
                    <Select value={platform} onChange={(v) => { setPlatform(v); setPage(1); }} style={{ width: 150 }}
                        options={[{ value: "", label: t("All platforms") }, { value: "facebook", label: "Facebook" }, { value: "instagram", label: "Instagram" }, { value: "tiktok", label: "TikTok" }]} />
                    <Input.Search
                        allowClear
                        prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
                        placeholder={t("Comment, name or phone")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onSearch={(v) => { setQuery(v.trim()); setPage(1); }}
                        style={{ width: 260 }}
                    />
                    {selected.length > 0 && (
                        <Button icon={<CheckOutlined />} onClick={() => setHandled(selected, true)}>
                            {t("Mark handled ({count})", { count: selected.length })}
                        </Button>
                    )}
                </Space>
                <Table
                    rowKey="id"
                    loading={loading}
                    dataSource={data?.rows ?? []}
                    scroll={{ x: "max-content" }}
                    rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
                    pagination={{ current: page, pageSize: 50, total: data?.total ?? 0, onChange: setPage, showSizeChanger: false, showTotal: (n) => t("{count} comments", { count: n }) }}
                    locale={{ emptyText: t("No comments yet.") }}
                    columns={[
                        {
                            title: t("Comment"),
                            key: "body",
                            render: (_, r) => (
                                <div style={{ maxWidth: 420 }}>
                                    <Space size={6} style={{ marginBottom: 4 }}>
                                        <ChannelTag channel={r.platform} />
                                        <Text strong>{r.author_name || t("(no name)")}</Text>
                                    </Space>
                                    <Paragraph style={{ margin: 0, whiteSpace: "pre-wrap" }} ellipsis={{ rows: 3, expandable: true, symbol: t("more") }}>{r.body || "—"}</Paragraph>
                                </div>
                            ),
                        },
                        {
                            title: t("Phone"),
                            key: "phone",
                            render: (_, r) => r.phone ? (
                                <Space orientation="vertical" size={2}>
                                    <a href={`tel:+216${r.phone}`}><PhoneOutlined /> {r.phone}</a>
                                    {r.customer && <Link href={`/admin/customers/${r.customer.id}`}>{r.customer.full_name || t("(no name)")}</Link>}
                                    {r.customer?.assigned_to_email && <Text type="secondary" style={{ fontSize: 12 }}>{r.customer.assigned_to_email}</Text>}
                                </Space>
                            ) : <Text type="secondary">—</Text>,
                        },
                        {
                            title: t("Call back"),
                            key: "task",
                            render: (_, r) => !r.task ? <Text type="secondary">—</Text> : r.task.done_at ? <Tag color="green">{t("Done")}</Tag> : <Tag color="orange">{t("To call")}</Tag>,
                        },
                        { title: t("Date"), dataIndex: "commented_at", render: (v: string) => formatDate(v, locale, true) },
                        {
                            title: "",
                            key: "handled",
                            render: (_, r) => r.handled_at ? (
                                <Tooltip title={[r.handled_by_email, formatDate(r.handled_at, locale, true)].filter(Boolean).join(" · ")}>
                                    <Button size="small" icon={<UndoOutlined />} onClick={() => setHandled([r.id], false)}>{t("Handled")}</Button>
                                </Tooltip>
                            ) : (
                                <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => setHandled([r.id], true)}>{t("Mark handled")}</Button>
                            ),
                        },
                    ]}
                />
            </Card>
        </div>
    );
}
