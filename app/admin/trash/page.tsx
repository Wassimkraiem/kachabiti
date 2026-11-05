"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Popconfirm, Select, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, UndoOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { message } from "@/components/admin/antd-app";
import { msg, useAdminT } from "@/lib/admin-i18n";
import { useAdminRole } from "@/lib/admin-role-context";
import type { TrashTable } from "@/lib/trash-tables";

const { Title, Paragraph } = Typography;

interface DeletedRow {
    id: string;
    label: string;
    deleted_at: string;
}

const TABLE_LABELS: Record<TrashTable, string> = {
    products: msg("Products"),
    product_variants: msg("Variants"),
    categories: msg("Categories"),
    colors: msg("Colors"),
    sizes: msg("Sizes"),
    product_discounts: msg("Product Discounts"),
    promotions: msg("Sale Banners"),
    reels: msg("Video Reels"),
    hero_sections: msg("Hero sections"),
    small_cards: msg("Hero cards"),
    orders: msg("Orders"),
    locations: msg("Locations"),
    suppliers: msg("Suppliers"),
    collections: msg("Collections"),
    team_tickets: msg("Team tasks"),
};

// What else goes with an erased row, shown before confirming.
const ERASES_WITH: Partial<Record<TrashTable, string>> = {
    products: msg("Its variants, photos, discounts, reviews and purchase costs are erased with it. Orders keep their lines."),
    product_variants: msg("Its photos and stock levels are erased with it. Orders and stock movements keep their lines."),
    orders: msg("Its lines are erased with it. Stock movements stay in the history."),
};

export default function TrashPage() {
    const { t } = useAdminT();
    const { isOwner } = useAdminRole();
    const [counts, setCounts] = useState<Partial<Record<TrashTable, number>>>({});
    const [table, setTable] = useState<TrashTable>();
    const [rows, setRows] = useState<DeletedRow[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [erasing, setErasing] = useState(false);

    const loadCounts = useCallback(async () => {
        try {
            const result = await (await fetch("/api/admin/trash")).json();
            if (!result.success) throw new Error(result.error);
            const next = result.data.counts as Partial<Record<TrashTable, number>>;
            setCounts(next);
            // Open the first area that has something in it.
            setTable((current) => current ?? (Object.keys(next) as TrashTable[]).find((key) => (next[key] ?? 0) > 0) ?? (Object.keys(next)[0] as TrashTable));
        } catch (error) {
            console.error("Error loading deleted items:", error);
            message.error(t("Failed to load deleted items"));
        }
    }, [t]);

    const loadRows = useCallback(async () => {
        if (!table) return;
        setLoading(true);
        setSelected([]);
        try {
            const result = await (await fetch(`/api/admin/trash?table=${table}`)).json();
            if (!result.success) throw new Error(result.error);
            setRows(result.data.rows);
        } catch (error) {
            console.error("Error loading deleted items:", error);
            message.error(t("Failed to load deleted items"));
        } finally {
            setLoading(false);
        }
    }, [table, t]);

    useEffect(() => {
        loadCounts();
    }, [loadCounts]);

    useEffect(() => {
        loadRows();
    }, [loadRows]);

    const erase = async (ids: string[]) => {
        if (!table || ids.length === 0) return;
        setErasing(true);
        try {
            const response = await fetch(`/api/admin/trash?table=${table}&ids=${ids.join(",")}`, { method: "DELETE" });
            const result = await response.json();
            if (!result.success) {
                const known: Record<string, string> = {
                    IN_USE: t("Some of these are still used by other records, so nothing was erased."),
                    HAS_STOCK: t("Some of these still hold stock. Record a movement to bring it to 0 first."),
                };
                message.error(known[result.code] ?? (result.error || t("Failed to erase")));
                return;
            }
            message.success(t("Erased {count} item(s) for good", { count: result.data.erased }));
            await Promise.all([loadRows(), loadCounts()]);
        } catch (error) {
            console.error("Error erasing deleted items:", error);
            message.error(t("Failed to erase"));
        } finally {
            setErasing(false);
        }
    };

    const restore = async (ids: string[]) => {
        if (!table || ids.length === 0) return;
        setErasing(true);
        try {
            const response = await fetch(`/api/admin/trash?table=${table}&ids=${ids.join(",")}`, { method: "PUT" });
            const result = await response.json();
            if (!result.success) {
                message.error(t(result.error || "Failed to restore"));
                return;
            }
            message.success(t("Restored {count} item(s). Products, banners and discounts stay off until you turn them on.", { count: result.data.restored }));
            await Promise.all([loadRows(), loadCounts()]);
        } catch (error) {
            console.error("Error restoring deleted items:", error);
            message.error(t("Failed to restore"));
        } finally {
            setErasing(false);
        }
    };

    const confirmText = (count: number) => (
        <div style={{ maxWidth: 320 }}>
            {t("Erase {count} item(s) for good? This can't be undone.", { count })}
            {table && ERASES_WITH[table] && <div style={{ marginTop: 8 }}>{t(ERASES_WITH[table]!)}</div>}
        </div>
    );

    const columns: ColumnsType<DeletedRow> = [
        { title: t("Item"), dataIndex: "label" },
        {
            title: t("Deleted on"),
            dataIndex: "deleted_at",
            width: 190,
            render: (date: string) => dayjs(date).format("DD MMM YYYY HH:mm"),
        },
        {
            title: t("Actions"),
            key: "actions",
            width: 270,
            render: (_, row) => (
                <div style={{ display: "flex", gap: 8 }}>
                    {isOwner && <Button size="small" icon={<UndoOutlined />} loading={erasing} onClick={() => restore([row.id])}>{t("Restore")}</Button>}
                    <Popconfirm title={confirmText(1)} okText={t("Erase")} okButtonProps={{ danger: true }} cancelText={t("Cancel")} onConfirm={() => erase([row.id])}>
                        <Button danger size="small" icon={<DeleteOutlined />} loading={erasing}>
                            {t("Erase for good")}
                        </Button>
                    </Popconfirm>
                </div>
            ),
        },
    ];

    const tableOptions = useMemo(
        () => (Object.keys(counts) as TrashTable[]).map((key) => ({
            value: key,
            label: (
                <span>
                    {t(TABLE_LABELS[key])} <Badge count={counts[key]} showZero color={counts[key] ? "red" : "#d9d9d9"} style={{ marginInlineStart: 6 }} />
                </span>
            ),
        })),
        [counts, t],
    );

    return (
        <div style={{ padding: 24 }}>
            <Title level={2} style={{ marginTop: 0 }}>{t("Deleted items")}</Title>
            <Paragraph type="secondary">
                {t(isOwner
                    ? "Deleting anything in the admin only hides it. Here you can restore deleted items or erase them for good. Everything is recorded in the activity history."
                    : "Deleting anything in the admin only hides it. Here you can erase deleted items for good. Every erase is recorded in the activity history.")}
            </Paragraph>
            <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={t("Erased items can't be restored.")} />

            <Card>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                    <Select style={{ minWidth: 260 }} value={table} onChange={setTable} options={tableOptions} />
                    {isOwner && (
                        <Button icon={<UndoOutlined />} disabled={selected.length === 0} loading={erasing} onClick={() => restore(selected)}>
                            {t("Restore selected ({count})", { count: selected.length })}
                        </Button>
                    )}
                    <Popconfirm
                        title={confirmText(selected.length)}
                        okText={t("Erase")}
                        okButtonProps={{ danger: true }}
                        cancelText={t("Cancel")}
                        onConfirm={() => erase(selected)}
                        disabled={selected.length === 0}
                    >
                        <Button danger icon={<DeleteOutlined />} disabled={selected.length === 0} loading={erasing}>
                            {t("Erase selected ({count})", { count: selected.length })}
                        </Button>
                    </Popconfirm>
                </div>

                <Table
                    rowKey="id"
                    size="middle"
                    loading={loading}
                    columns={columns}
                    dataSource={rows}
                    rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
                    pagination={{ pageSize: 50, showSizeChanger: true }}
                    locale={{ emptyText: t("Nothing deleted here") }}
                    scroll={{ x: 600 }}
                />
            </Card>
        </div>
    );
}
