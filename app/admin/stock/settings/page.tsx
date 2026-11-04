"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Table, Typography, Space, Button, Tag, Tabs, Modal, Form, Input, InputNumber, Switch, Popconfirm } from "antd";
import { message } from "@/components/admin/antd-app";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { useAdminRole } from "@/lib/admin-role-context";
import { apiJson } from "@/components/admin/stock/stock-client";
import { useAdminT } from "@/lib/admin-i18n";

const { Title, Text } = Typography;

type Row = { id: string; name: string; [key: string]: unknown };

interface FieldDef {
    name: string;
    label: string;
    kind?: "text" | "switch" | "textarea" | "number";
    help?: string;
}

interface ListConfig {
    key: string;
    title: string;
    addLabel: string;
    addedMessage: string;
    updatedMessage: string;
    endpoint: string;
    help: string;
    fields: FieldDef[];
    columns: ColumnsType<Row>;
}

// Built per render so the labels follow the admin language.
const buildLists = (t: (text: string) => string): ListConfig[] => [
    {
        key: "locations",
        title: t("Locations"),
        addLabel: t("Add location"),
        addedMessage: t("Location added"),
        updatedMessage: t("Location updated"),
        endpoint: "/api/stock/locations",
        help: t("Where stock is kept. The online location is the one the website sells from and confirmed orders deduct from."),
        fields: [
            { name: "name", label: t("Name") },
            { name: "sells_online", label: t("Sells online"), kind: "switch", help: "Only one location can sell online; choosing this one switches the others off." },
            { name: "is_shop", label: t("Shop with a caisse"), kind: "switch", help: t("Shops appear in Point of sale, each with its own stock and till.") },
            { name: "low_stock_limit", label: t("Low-stock alert at"), kind: "number", help: t("Alert when a product here reaches this quantity. Empty: use each product's reorder point.") },
        ],
        columns: [
            { title: t("Name"), dataIndex: "name" },
            { title: t("Website"), dataIndex: "sells_online", render: (v) => (v ? <Tag color="green">{t("Sells online")}</Tag> : <Text type="secondary">{t("Not online")}</Text>) },
            { title: t("Shop"), dataIndex: "is_shop", render: (v) => (v ? <Tag color="blue">{t("Shop")}</Tag> : null) },
            { title: t("Alert at"), dataIndex: "low_stock_limit", render: (v) => v ?? t("Reorder point") },
        ],
    },
    {
        key: "suppliers",
        title: t("Suppliers"),
        addLabel: t("Add supplier"),
        addedMessage: t("Supplier added"),
        updatedMessage: t("Supplier updated"),
        endpoint: "/api/stock/suppliers",
        help: t("Workshops and vendors you buy from. Assign them on products to group the restock list."),
        fields: [
            { name: "name", label: t("Name") },
            { name: "phone", label: t("Phone") },
            { name: "email", label: t("Email") },
            { name: "notes", label: t("Notes"), kind: "textarea" },
        ],
        columns: [
            { title: t("Name"), dataIndex: "name" },
            { title: t("Phone"), dataIndex: "phone" },
            { title: t("Email"), dataIndex: "email" },
            { title: t("Notes"), dataIndex: "notes", ellipsis: true },
        ],
    },
    {
        key: "collections",
        title: t("Collections"),
        addLabel: t("Add collection"),
        addedMessage: t("Collection added"),
        updatedMessage: t("Collection updated"),
        endpoint: "/api/stock/collections",
        help: t("Seasonal or themed groupings for your own reporting (for example Winter 2026)."),
        fields: [{ name: "name", label: t("Name") }],
        columns: [{ title: t("Name"), dataIndex: "name" }],
    },
];

function ListEditor({ config }: { config: ListConfig }) {
    const { t } = useAdminT();
    const canDelete = useAdminRole().can("delete");
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<Row | null>(null);
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setRows(await apiJson<Row[]>(config.endpoint));
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setLoading(false);
        }
    }, [config.endpoint]);

    useEffect(() => {
        load();
    }, [load]);

    const openForm = (row: Row | null) => {
        setEditing(row);
        form.resetFields();
        form.setFieldsValue(row ?? {});
        setOpen(true);
    };

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            await apiJson(config.endpoint, {
                method: editing ? "PUT" : "POST",
                body: JSON.stringify(editing ? { id: editing.id, ...values } : values),
            });
            message.success(editing ? config.updatedMessage : config.addedMessage);
            setOpen(false);
            load();
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setSaving(false);
        }
    };

    const remove = async (row: Row) => {
        try {
            await apiJson(`${config.endpoint}?id=${row.id}`, { method: "DELETE" });
            message.success(t("{name} deleted", { name: row.name }));
            load();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const columns: ColumnsType<Row> = [
        ...config.columns,
        {
            key: "actions",
            width: 110,
            render: (_, row) => (
                <Space>
                    <Button type="text" icon={<EditOutlined />} aria-label={t("Edit {name}", { name: row.name })} onClick={() => openForm(row)} />
                    {canDelete && (
                        <Popconfirm
                            title={t("Delete {name}?", { name: row.name })}
                            description={config.key === "locations" ? t("Only possible when no stock or movements use it.") : t("Products using it are unassigned.")}
                            okText={t("Delete")}
                            okButtonProps={{ danger: true }}
                            onConfirm={() => remove(row)}
                        >
                            <Button type="text" danger icon={<DeleteOutlined />} aria-label={t("Delete {name}", { name: row.name })} />
                        </Popconfirm>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12 }}>
                <Text type="secondary">{config.help}</Text>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm(null)}>{config.addLabel}</Button>
            </div>
            <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} pagination={false} />
            <Modal
                open={open}
                title={editing ? t("Edit {name}", { name: editing.name }) : config.addLabel}
                onCancel={() => setOpen(false)}
                onOk={save}
                okText={editing ? t("Save changes") : config.addLabel}
                confirmLoading={saving}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    {config.fields.map((field) => (
                        <Form.Item
                            key={field.name}
                            name={field.name}
                            label={field.label}
                            extra={field.help}
                            valuePropName={field.kind === "switch" ? "checked" : "value"}
                            rules={field.name === "name" ? [{ required: true, whitespace: true, message: t("Enter a name") }] : undefined}
                        >
                            {field.kind === "switch" ? <Switch /> : field.kind === "number" ? <InputNumber min={0} precision={0} style={{ width: "100%" }} /> : field.kind === "textarea" ? <Input.TextArea rows={3} /> : <Input />}
                        </Form.Item>
                    ))}
                </Form>
            </Modal>
        </>
    );
}

export default function StockSettingsPage() {
    const { t } = useAdminT();
    return (
        <Space orientation="vertical" size="large" style={{ width: "100%" }}>
            <div>
                <Title level={2} style={{ margin: 0 }}>{t("Stock settings")}</Title>
                <Text type="secondary">{t("Locations, suppliers and collections used by inventory and products.")}</Text>
            </div>
            <Card>
                <Tabs items={buildLists(t).map((config) => ({ key: config.key, label: config.title, children: <ListEditor config={config} /> }))} />
            </Card>
        </Space>
    );
}
