"use client";

import { useState } from "react";
import { Alert, Button, Card, Checkbox, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from "antd";
import { KeyOutlined, PlusOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { ALL_PERMISSIONS, PERMISSIONS, type Permission } from "@/lib/admin-auth";
import { PageHeader } from "@/components/admin/erp/ui";
import { api, formatDate, useApi } from "@/components/admin/erp/erp-client";

const { Text, Paragraph } = Typography;

interface ApiKey {
    id: string;
    name: string;
    prefix: string;
    permissions: Permission[];
    created_by_email: string | null;
    expires_at: string | null;
    last_used_at: string | null;
    created_at: string;
}

// Permanent deletes are never given to a key (the API refuses them too).
const KEY_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p !== "hard_delete");

/**
 * Admin → Team → API keys: keys for outside systems such as a developer or a customer-support
 * agent. A key acts as a staff member with only the permissions ticked here (header x-api-key on
 * https://api.kachabiti.com/api). The key is shown once; revoking stops it at once.
 */
export default function ApiKeysPage() {
    const { t, locale } = useAdminT();
    const { data, loading, reload } = useApi<ApiKey[]>("/api/admin/team/api-keys");
    const [creating, setCreating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [created, setCreated] = useState<string | null>(null);
    const [form] = Form.useForm();

    const create = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            const result = await api<{ key: string }>("/api/admin/team/api-keys", { method: "POST", body: values });
            setCreating(false);
            form.resetFields();
            setCreated(result.key);
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setSaving(false);
        }
    };

    const revoke = async (id: string) => {
        try {
            await api(`/api/admin/team/api-keys?id=${id}`, { method: "DELETE" });
            message.success(t("Key revoked"));
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    return (
        <div>
            <PageHeader
                title={t("API keys")}
                subtitle={t("Keys for outside systems, such as a developer or a customer-support agent. Each acts as a staff member with only the permissions you tick.")}
                crumbs={[{ title: t("Team"), href: "/admin/team" }]}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>{t("New key")}</Button>}
            />
            <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                title={t("How to use a key")}
                description={
                    <span>
                        {t("Send it in the x-api-key header to")} <Text code>https://api.kachabiti.com/api</Text>. {t("Routes and examples:")}{" "}
                        <a href="/api-docs" target="_blank" rel="noopener noreferrer">/api-docs</a>. {t("Everything a key does is in the activity log under its name.")}
                    </span>
                }
            />
            <Card>
                <Table
                    rowKey="id"
                    loading={loading}
                    dataSource={data ?? []}
                    scroll={{ x: "max-content" }}
                    pagination={false}
                    locale={{ emptyText: t("No API keys yet.") }}
                    columns={[
                        {
                            title: t("Name"),
                            key: "name",
                            render: (_, k) => (
                                <div>
                                    <Text strong>{k.name}</Text>
                                    <div><Text type="secondary" style={{ fontFamily: "monospace", fontSize: 12 }}>{k.prefix}…</Text></div>
                                </div>
                            ),
                        },
                        {
                            title: t("Permissions"),
                            dataIndex: "permissions",
                            render: (perms: Permission[]) => <Space size={4} wrap>{perms.map((p) => <Tag key={p}>{t(PERMISSIONS[p]?.label ?? p)}</Tag>)}</Space>,
                        },
                        {
                            title: t("Expires"),
                            dataIndex: "expires_at",
                            render: (v: string | null) => {
                                if (!v) return "—";
                                const past = new Date(v) <= new Date();
                                return <Text type={past ? "danger" : undefined}>{formatDate(v, locale)}{past ? ` · ${t("Expired")}` : ""}</Text>;
                            },
                        },
                        { title: t("Last used"), dataIndex: "last_used_at", render: (v: string | null) => (v ? formatDate(v, locale, true) : t("Never")) },
                        { title: t("Made by"), dataIndex: "created_by_email", render: (v: string | null) => v ?? "—" },
                        {
                            title: "",
                            key: "revoke",
                            render: (_, k) => (
                                <Popconfirm
                                    title={t("Revoke {name}?", { name: k.name })}
                                    description={t("Its next request is refused. This can't be undone; make a new key instead.")}
                                    okText={t("Revoke")}
                                    cancelText={t("Cancel")}
                                    onConfirm={() => revoke(k.id)}
                                >
                                    <Button danger size="small">{t("Revoke")}</Button>
                                </Popconfirm>
                            ),
                        },
                    ]}
                />
            </Card>

            <Modal open={creating} title={t("New key")} onCancel={() => setCreating(false)} onOk={create} okText={t("Create key")} cancelText={t("Cancel")} confirmLoading={saving} forceRender>
                <Form form={form} layout="vertical" initialValues={{ permissions: ["orders", "customers"], expires_in_days: 30 }}>
                    <Form.Item name="name" label={t("Name")} rules={[{ required: true, max: 80 }]} extra={t("Who or what uses it, e.g. Support agent – Acme")}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="permissions" label={t("Permissions")} rules={[{ required: true, type: "array", min: 1 }]} extra={t("Give only what it needs. A support agent usually needs Orders and Customers.")}>
                        <Checkbox.Group style={{ display: "grid", gap: 6 }}>
                            {KEY_PERMISSIONS.map((p) => (
                                <Checkbox key={p} value={p}>
                                    {t(PERMISSIONS[p].label)} <Text type="secondary" style={{ fontSize: 12 }}>– {t(PERMISSIONS[p].description)}</Text>
                                </Checkbox>
                            ))}
                        </Checkbox.Group>
                    </Form.Item>
                    <Form.Item name="expires_in_days" label={t("Expires after")}>
                        <Select options={[7, 30, 90, 365].map((d) => ({ value: d, label: t("{count} days", { count: d }) }))} />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal open={!!created} title={<span><KeyOutlined /> {t("Your new key")}</span>} onCancel={() => setCreated(null)} footer={<Button type="primary" onClick={() => setCreated(null)}>{t("I've saved it")}</Button>}>
                <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={t("Copy it now: it won't be shown again.")} description={t("Send it privately. Anyone with it can act with its permissions until it expires or you revoke it.")} />
                <Paragraph copyable={{ text: created ?? "" }} style={{ fontFamily: "monospace", wordBreak: "break-all", background: "#fafafa", padding: 12, borderRadius: 8 }}>
                    {created}
                </Paragraph>
            </Modal>
        </div>
    );
}
