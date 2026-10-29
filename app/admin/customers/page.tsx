"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { PlusOutlined, RobotOutlined, SearchOutlined, TeamOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { useAdminRole } from "@/lib/admin-role-context";
import { governorateOptions } from "@/lib/colissimo-data";
import { CHANNELS, CHANNEL_LABELS, CUSTOMER_STAGES, STAGE_COLORS, STAGE_LABELS, type CustomerStage } from "@/lib/erp/constants";
import { AgentSelect, ChannelTag, PageHeader } from "@/components/admin/erp/ui";
import { api, formatDate, useApi } from "@/components/admin/erp/erp-client";

const { Text } = Typography;

interface CustomerRow {
    id: string;
    phone: string | null;
    full_name: string;
    email: string | null;
    governorate: string | null;
    city: string | null;
    channel: string;
    stage: CustomerStage;
    assigned_to_email: string | null;
    tags: string[];
    updated_at: string;
    anonymized_at: string | null;
    bot_status: "bot" | "human" | "off";
    lead_label: "interested" | "not_interested" | "gibberish" | null;
}

interface ListResult {
    rows: CustomerRow[];
    total: number;
    page: number;
    size: number;
    stages: Record<CustomerStage, number>;
}

interface DuplicatePair {
    reason: string;
    a: CustomerRow;
    b: CustomerRow;
}

/**
 * Admin → Customers (CRM). Everyone who ordered or wrote to us, one record per phone. The tabs
 * are the sales pipeline: new contact, interested, order to confirm, confirmed, shipped,
 * delivered, cancelled (the order stages follow the customer's latest order automatically).
 */
export default function CustomersPage() {
    const { t, locale } = useAdminT();
    const { isAdmin, can } = useAdminRole();
    const [stage, setStage] = useState<string>("all");
    const [search, setSearch] = useState("");
    const [query, setQuery] = useState("");
    const [channel, setChannel] = useState("");
    const [assigned, setAssigned] = useState("");
    const [bot, setBot] = useState("");
    const [page, setPage] = useState(1);
    const [creating, setCreating] = useState(false);
    const [showDuplicates, setShowDuplicates] = useState(false);
    const [form] = Form.useForm();

    const url = useMemo(() => {
        const qs = new URLSearchParams({ page: String(page), size: "50" });
        if (stage !== "all") qs.set("stage", stage);
        if (query) qs.set("q", query);
        if (channel) qs.set("channel", channel);
        if (assigned) qs.set("assigned", assigned);
        if (bot) qs.set("bot", bot);
        return `/api/customers?${qs}`;
    }, [page, stage, query, channel, assigned, bot]);
    const { data, loading, reload } = useApi<ListResult>(url);
    const duplicates = useApi<DuplicatePair[]>(showDuplicates ? "/api/customers?duplicates=1" : null);

    const create = async () => {
        const values = await form.validateFields();
        try {
            const created = await api<{ id: string }>("/api/customers", { method: "POST", body: { ...values, tags: [] } });
            message.success(t("Customer added"));
            setCreating(false);
            form.resetFields();
            window.location.href = `/admin/customers/${created.id}`;
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const merge = async (keep: string, remove: string) => {
        try {
            await api("/api/customers", { method: "PATCH", body: { action: "merge", keep_id: keep, remove_id: remove } });
            message.success(t("Customers merged"));
            duplicates.reload();
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const total = Object.values(data?.stages ?? {}).reduce((s, n) => s + n, 0);

    return (
        <div>
            <PageHeader
                title={t("Customers")}
                subtitle={t("Everyone who ordered or contacted the shop, and where they are in the sales pipeline.")}
                extra={
                    <>
                        <Button icon={<TeamOutlined />} onClick={() => setShowDuplicates(true)}>{t("Find duplicates")}</Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>{t("New customer")}</Button>
                    </>
                }
            />
            <Card>
                <Tabs
                    activeKey={stage}
                    onChange={(key) => { setStage(key); setPage(1); }}
                    items={[
                        { key: "all", label: `${t("All")} (${total})` },
                        ...CUSTOMER_STAGES.map((s) => ({ key: s, label: `${t(STAGE_LABELS[s])} (${data?.stages?.[s] ?? 0})` })),
                    ]}
                />
                <Space wrap style={{ marginBottom: 16 }}>
                    <Input.Search
                        allowClear
                        prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
                        placeholder={t("Name, phone, email or city")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onSearch={(v) => { setQuery(v.trim()); setPage(1); }}
                        style={{ width: 280 }}
                    />
                    <Select value={channel} onChange={(v) => { setChannel(v); setPage(1); }} style={{ width: 170 }}
                        options={[{ value: "", label: t("All channels") }, ...CHANNELS.map((c) => ({ value: c, label: t(CHANNEL_LABELS[c]) }))]} />
                    <Select value={assigned} onChange={(v) => { setAssigned(v); setPage(1); }} style={{ width: 190 }}
                        options={[{ value: "", label: t("Handled by: anyone") }, { value: "me", label: t("Handled by me") }, { value: "none", label: t("Nobody yet") }]} />
                    <Select value={bot} onChange={(v) => { setBot(v); setPage(1); }} style={{ width: 210 }}
                        options={[{ value: "", label: t("Bot: everyone") }, { value: "human", label: t("Waiting for an agent") }, { value: "bot", label: t("The bot answers") }, { value: "off", label: t("Bot off for this customer") }]} />
                </Space>
                <Table
                    rowKey="id"
                    loading={loading}
                    dataSource={data?.rows ?? []}
                    scroll={{ x: "max-content" }}
                    pagination={{ current: page, pageSize: 50, total: data?.total ?? 0, onChange: setPage, showSizeChanger: false, showTotal: (n) => t("{count} customers", { count: n }) }}
                    columns={[
                        {
                            title: t("Customer"),
                            key: "name",
                            render: (_, r) => (
                                <div>
                                    <Link href={`/admin/customers/${r.id}`} style={{ fontWeight: 500 }}>{r.full_name || t("(no name)")}</Link>
                                    <div style={{ fontSize: 12, color: "#8c8c8c" }}>{[r.phone, r.email].filter(Boolean).join(" · ")}</div>
                                    {r.tags.map((tag) => <Tag key={tag} style={{ marginTop: 4 }}>{tag}</Tag>)}
                                </div>
                            ),
                        },
                        { title: t("Stage"), dataIndex: "stage", render: (v: CustomerStage) => <Tag color={STAGE_COLORS[v]}>{t(STAGE_LABELS[v])}</Tag> },
                        { title: t("Came from"), dataIndex: "channel", render: (v: string) => <ChannelTag channel={v} /> },
                        {
                            title: <RobotOutlined />,
                            key: "bot",
                            render: (_, r) => (
                                <Space size={4} wrap>
                                    {r.bot_status === "human" && <Tag color="orange">{t("Waiting for an agent")}</Tag>}
                                    {r.lead_label === "interested" && <Tag color="green">{t("Interested")}</Tag>}
                                    {r.lead_label === "not_interested" && <Tag>{t("Not interested")}</Tag>}
                                    {r.lead_label === "gibberish" && <Tag color="red">{t("Gibberish")}</Tag>}
                                </Space>
                            ),
                        },
                        { title: t("City"), key: "city", render: (_, r) => [r.city, r.governorate].filter(Boolean).join(", ") || "—" },
                        { title: t("Handled by"), dataIndex: "assigned_to_email", render: (v: string | null) => v ?? <Text type="secondary">—</Text> },
                        { title: t("Last activity"), dataIndex: "updated_at", render: (v: string) => formatDate(v, locale, true) },
                    ]}
                />
            </Card>

            <Modal open={creating} title={t("New customer")} onCancel={() => setCreating(false)} onOk={create} okText={t("Save")} cancelText={t("Cancel")} forceRender>
                <Form form={form} layout="vertical" initialValues={{ channel: "facebook", stage: "new" }}>
                    <Form.Item name="full_name" label={t("Name")} rules={[{ required: true }]}><Input /></Form.Item>
                    <Form.Item name="phone" label={t("Phone")}><Input inputMode="tel" /></Form.Item>
                    <Space style={{ display: "flex" }} wrap>
                        <Form.Item name="channel" label={t("Came from")}><Select style={{ width: 180 }} options={CHANNELS.map((c) => ({ value: c, label: t(CHANNEL_LABELS[c]) }))} /></Form.Item>
                        <Form.Item name="stage" label={t("Stage")}><Select style={{ width: 180 }} options={CUSTOMER_STAGES.map((s) => ({ value: s, label: t(STAGE_LABELS[s]) }))} /></Form.Item>
                    </Space>
                    <Form.Item name="governorate" label={t("Governorate")}><Select allowClear showSearch optionFilterProp="label" options={governorateOptions(locale)} /></Form.Item>
                    <Form.Item name="city" label={t("City")}><Input /></Form.Item>
                    <Form.Item name="notes" label={t("Notes")}><Input.TextArea rows={3} /></Form.Item>
                    {isAdmin && <Form.Item name="assigned_to" label={t("Handled by")}><AgentSelect /></Form.Item>}
                </Form>
            </Modal>

            <Modal open={showDuplicates} title={t("Possible duplicates")} onCancel={() => setShowDuplicates(false)} footer={null} width={860} forceRender>
                <Text type="secondary">{t("Records with the same e-mail, the same second phone, or the same name in the same city. Merging keeps the first record and moves the other's orders and conversations onto it.")}</Text>
                <Table
                    style={{ marginTop: 12 }}
                    size="small"
                    loading={duplicates.loading}
                    rowKey={(r) => `${r.a?.id}-${r.b?.id}`}
                    dataSource={(duplicates.data ?? []).filter((p) => p.a && p.b)}
                    pagination={{ pageSize: 10 }}
                    locale={{ emptyText: t("No duplicates found.") }}
                    columns={[
                        { title: t("Keep"), key: "a", render: (_, r) => <Link href={`/admin/customers/${r.a.id}`}>{r.a.full_name || r.a.phone}</Link> },
                        { title: t("Duplicate"), key: "b", render: (_, r) => <Link href={`/admin/customers/${r.b.id}`}>{r.b.full_name || r.b.phone}</Link> },
                        { title: t("Why"), dataIndex: "reason", render: (v: string) => t(v === "email" ? "Same e-mail" : v === "phone" ? "Same phone" : "Same name and city") },
                        {
                            title: "", key: "merge", render: (_, r) => (can("delete") || isAdmin) && (
                                <Button size="small" onClick={() => merge(r.a.id, r.b.id)}>{t("Merge")}</Button>
                            ),
                        },
                    ]}
                />
            </Modal>
        </div>
    );
}
