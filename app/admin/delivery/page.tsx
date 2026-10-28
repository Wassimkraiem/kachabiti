"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Breadcrumb, Button, Card, DatePicker, Input, Modal, Popconfirm, Segmented, Space, Table, Tooltip, Typography } from "antd";
import type { Dayjs } from "dayjs";
import type { ColumnsType } from "antd/es/table";
import { BarcodeOutlined, DeleteOutlined, EditOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined, SendOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminRole } from "@/lib/admin-role-context";
import { DATE_LOCALES, useAdminT } from "@/lib/admin-i18n";
import { statusInfo, type StatusGroup } from "@/lib/colissimo-data";
import DeliveryStatusTag, { ParcelBadges } from "@/components/admin/delivery/DeliveryStatusTag";
import SendParcelModal from "@/components/admin/delivery/SendParcelModal";
import ParcelLookup from "@/components/admin/delivery/ParcelLookup";
import EditParcelModal from "@/components/admin/delivery/EditParcelModal";
import ParcelHistoryDrawer from "@/components/admin/delivery/ParcelHistoryDrawer";
import {
    canEditParcel,
    canRemoveParcel,
    deliveryApi,
    type Delivery,
    type DeliveryList,
    type HandOverResult,
    type RefreshResult,
    type RemoveResult,
} from "@/components/admin/delivery/delivery-api";

const { Title, Text } = Typography;

// "validate": parcels created but not yet validated (handed over) at Colissimo; "pending" is then
// only the validated ones waiting for the driver.
type Filter = "all" | "validate" | StatusGroup;
const tabOf = (row: Delivery): Filter => (canEditParcel(row) ? "validate" : statusInfo(row.status).group);

/**
 * Admin → Delivery: the parcels sent to Colissimo from the orders (or added by barcode), with
 * their live status (checked automatically every 15 minutes). Parcels waiting for pickup are
 * handed over in one click (Colissimo's manifest), edited, or deleted at Colissimo. Its API
 * can't list an account's parcels, so parcels created on its website appear once added by barcode.
 */
export default function DeliveryPage() {
    const { t, locale } = useAdminT();
    const canDelete = useAdminRole().can("delete");
    const [data, setData] = useState<DeliveryList | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [filter, setFilter] = useState<Filter>("all");
    const [search, setSearch] = useState("");
    const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
    const [selected, setSelected] = useState<string[]>([]);
    const [importOpen, setImportOpen] = useState(false);
    const [barcode, setBarcode] = useState("");
    const [importing, setImporting] = useState(false);
    const [newOpen, setNewOpen] = useState(false);
    const [editing, setEditing] = useState<Delivery | null>(null);
    const [historyFor, setHistoryFor] = useState<string | null>(null);
    const [handingOver, setHandingOver] = useState(false);
    const [handOverResult, setHandOverResult] = useState<HandOverResult | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setData(await deliveryApi<DeliveryList>());
        } catch (e) {
            message.error((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const refreshStatuses = async (ids?: string[]) => {
        setRefreshing(true);
        try {
            const result = await deliveryApi<RefreshResult>({ method: "POST", body: { action: "refresh", ids } });
            if (result.failures.length) {
                message.warning(t("{count} parcel(s) couldn't be checked: {error}", { count: result.failures.length, error: result.failures[0].error }));
            }
            message.success(t("Checked {checked} parcel(s), {changed} changed", { checked: result.checked, changed: result.changed }));
            await load();
        } catch (e) {
            message.error((e as Error).message);
        } finally {
            setRefreshing(false);
        }
    };

    const importParcel = async () => {
        setImporting(true);
        try {
            await deliveryApi({ method: "POST", body: { action: "import", barcode: barcode.trim() } });
            message.success(t("Parcel {barcode} added", { barcode }));
            setImportOpen(false);
            setBarcode("");
            await load();
        } catch (e) {
            message.error((e as Error).message);
        } finally {
            setImporting(false);
        }
    };

    const remove = async (ids: string[]) => {
        try {
            const result = await deliveryApi<RemoveResult>({ method: "DELETE", query: `ids=${ids.join(",")}` });
            if (result.deleted) message.success(t("Removed {count} parcel(s)", { count: result.deleted }));
            if (result.kept.length) {
                message.warning(t("{count} parcel(s) kept: {reason}", { count: result.kept.length, reason: t(result.kept[0].reason) }), 8);
            }
            setSelected([]);
            await load();
        } catch (e) {
            message.error((e as Error).message);
        }
    };

    // Parcels selected that are waiting for pickup: the ones Colissimo can take in a manifest.

    const handOver = async () => {
        setHandingOver(true);
        try {
            const result = await deliveryApi<HandOverResult>({ method: "POST", body: { action: "handover", ids: waiting } });
            setHandOverResult(result);
            setSelected([]);
            await load();
        } catch (e) {
            message.error((e as Error).message);
        } finally {
            setHandingOver(false);
        }
    };

    // Parcels sent within the chosen dates (by creation); the tabs count these.
    const inRange = useMemo(() => {
        const from = range?.[0]?.startOf("day").valueOf() ?? -Infinity;
        const to = range?.[1]?.endOf("day").valueOf() ?? Infinity;
        return (data?.rows ?? []).filter((row) => {
            const sent = new Date(row.created_at).getTime();
            return sent >= from && sent <= to;
        });
    }, [data, range]);

    const rows = useMemo(() => {
        const term = search.trim().toLowerCase();
        return inRange.filter((row) => {
            if (filter !== "all" && tabOf(row) !== filter) return false;
            if (!term) return true;
            const customer = row.order ? `${row.order.customer_first_name} ${row.order.customer_last_name}` : "";
            return [row.barcode, row.recipient_name, row.phone, row.governorate, row.city, row.order?.order_number, customer]
                .some((value) => value?.toLowerCase().includes(term));
        });
    }, [inRange, filter, search]);

    const counts = useMemo(() => {
        const result: Record<Filter, number> = { all: 0, validate: 0, pending: 0, moving: 0, delivered: 0, returned: 0, problem: 0 };
        for (const row of inRange) {
            result.all += 1;
            result[tabOf(row)] += 1;
        }
        return result;
    }, [inRange]);

    const waiting = useMemo(() => {
        const ticked = rows.filter((row) => selected.includes(row.id) && canEditParcel(row));
        return (ticked.length ? ticked : rows.filter(canEditParcel)).map((row) => row.id);
    }, [rows, selected]);

    const formatDate = (date: string | null) => (date ? new Date(date).toLocaleString(DATE_LOCALES[locale], { dateStyle: "short", timeStyle: "short" }) : "—");

    const columns: ColumnsType<Delivery> = [
        {
            title: t("Barcode / order"),
            dataIndex: "barcode",
            key: "barcode",
            render: (value: string | null, row) => (
                <div>
                    {value ? <Text copyable style={{ fontFamily: "monospace" }}>{value}</Text> : "—"}
                    <div style={{ fontSize: 12 }}>
                        {row.order ? (
                            <Link href={`/admin/orders/${row.order.id}`} style={{ fontFamily: "monospace" }}>{row.order.order_number}</Link>
                        ) : (
                            <Text type="secondary">{t("Not linked")}</Text>
                        )}
                    </div>
                </div>
            ),
        },
        {
            title: t("Customer"),
            key: "customer",
            render: (_, row) => (
                <div>
                    <div style={{ fontWeight: 500 }}>{row.recipient_name || (row.order ? `${row.order.customer_first_name} ${row.order.customer_last_name}` : "—")}</div>
                    {row.phone && <Text type="secondary" style={{ fontSize: 12 }}>{row.phone}</Text>}
                </div>
            ),
        },
        {
            title: t("Destination"),
            key: "destination",
            render: (_, row) => [row.city, row.governorate].filter(Boolean).join(", ") || "—",
        },
        {
            title: t("Cash to collect"),
            dataIndex: "cod_amount",
            key: "cod_amount",
            render: (value: number | null) => (value != null ? `${Number(value)} TND` : "—"),
        },
        {
            title: t("Status"),
            key: "status",
            render: (_, row) => (
                <Space orientation="vertical" size={2}>
                    <DeliveryStatusTag status={row.status} reason={row.status_reason} />
                    <ParcelBadges delivery={row} />
                </Space>
            ),
        },
        {
            title: t("Last change"),
            key: "status_changed_at",
            sorter: (a, b) => new Date(a.status_changed_at ?? a.created_at).getTime() - new Date(b.status_changed_at ?? b.created_at).getTime(),
            render: (_, row) => (
                <div>
                    {formatDate(row.status_changed_at ?? row.created_at)}
                    <div><Text type="secondary" style={{ fontSize: 12 }}>{t("Sent {date}", { date: formatDate(row.created_at) })}</Text></div>
                </div>
            ),
        },
        {
            title: t("Action"),
            key: "action",
            fixed: "right",
            render: (_, row) => (
                <Space size={0}>
                    {row.label_url && (
                        <Tooltip title={t("Slip")}>
                            <Button type="link" size="small" icon={<PrinterOutlined />} href={row.label_url} target="_blank" rel="noopener noreferrer" aria-label={t("Slip")} />
                        </Tooltip>
                    )}
                    {row.barcode && (
                        <Tooltip title={t("Check")}>
                            <Button type="link" size="small" icon={<ReloadOutlined />} onClick={() => refreshStatuses([row.id])} aria-label={t("Check")} />
                        </Tooltip>
                    )}
                    {canEditParcel(row) && (
                        <Tooltip title={t("Edit")}>
                            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => setEditing(row)} aria-label={t("Edit")} />
                        </Tooltip>
                    )}
                    {canDelete && canRemoveParcel(row) && (
                        <Popconfirm
                            styles={{ root: { maxWidth: 360 } }}
                            title={t("Remove this parcel?")}
                            description={t("A parcel waiting for pickup is deleted at Colissimo too. One Colissimo already has can't be removed. The order can then be sent again.")}
                            okText={t("Remove")}
                            cancelText={t("Cancel")}
                            onConfirm={() => remove([row.id])}
                        >
                            <Button type="link" size="small" danger icon={<DeleteOutlined />} aria-label={t("Remove")} />
                        </Popconfirm>
                    )}
                </Space>
            ),
        },
    ];

    const filterLabel = (label: string, key: Filter) => `${t(label)} (${counts[key]})`;

    return (
        <div>
            <Breadcrumb items={[{ title: <Link href="/admin/dashboard">{t("Dashboard")}</Link> }, { title: t("Delivery") }]} />
            <div style={{ marginTop: 24, marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                    <Title level={2} style={{ margin: 0, fontWeight: 600 }}>{t("Delivery (Colissimo)")}</Title>
                    <Text type="secondary">{t("Your Colissimo parcels and their status. Create one here, or send an order from its page.")}</Text>
                    {data?.configured.tracking && (
                        <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                {data.tracking
                                    ? t("Statuses update automatically every 15 minutes · last check {time}", { time: formatDate(data.tracking.at) })
                                    : t("Statuses update automatically every 15 minutes")}
                            </Text>
                        </div>
                    )}
                </div>
                <Space wrap>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        disabled={!data?.configured.add}
                        onClick={() => setNewOpen(true)}
                        style={{ background: "#7a3b2e", borderColor: "#7a3b2e" }}
                    >
                        {t("New parcel")}
                    </Button>
                    <Button icon={<BarcodeOutlined />} disabled={!data?.configured.tracking} onClick={() => setImportOpen(true)}>{t("Add by barcode")}</Button>
                    <Button
                        icon={<ReloadOutlined />}
                        loading={refreshing}
                        disabled={!data?.configured.tracking}
                        onClick={() => refreshStatuses()}
                    >
                        {t("Refresh statuses")}
                    </Button>
                </Space>
            </div>

            {data && (!data.configured.add || !data.configured.tracking) && (
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    title={t("Colissimo isn't connected yet")}
                    description={t("Add COLISSIMO_ADD_TOKEN and COLISSIMO_TRACKING_TOKEN (from your Colissimo account, Paramètres → APIs) to the server environment.")}
                />
            )}

            <ParcelLookup disabled={!data?.configured.tracking} onAdded={load} />

            <Card>
                <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                    <div style={{ overflowX: "auto" }}>
                        <Segmented<Filter>
                            value={filter}
                            onChange={setFilter}
                            options={[
                                { value: "all", label: filterLabel("All", "all") },
                                { value: "validate", label: filterLabel("To validate", "validate") },
                                { value: "pending", label: filterLabel("To be picked up", "pending") },
                                { value: "moving", label: filterLabel("On the way", "moving") },
                                { value: "delivered", label: filterLabel("Delivered", "delivered") },
                                { value: "returned", label: filterLabel("Returns", "returned") },
                                { value: "problem", label: filterLabel("To check", "problem") },
                            ]}
                        />
                    </div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                        <Input
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder={t("Search barcode, order, customer, phone, city")}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ maxWidth: 360 }}
                        />
                        <DatePicker.RangePicker value={range} onChange={setRange} placeholder={[t("Sent from"), t("to")]} allowEmpty={[true, true]} />
                        {waiting.length > 0 && (
                            <Popconfirm
                                styles={{ root: { maxWidth: 360 } }}
                                title={t("Validate {count} parcel(s) for pickup by Colissimo?", { count: waiting.length })}
                                description={t("Colissimo makes a pickup list (manifest) and the driver comes for them. They can no longer be edited, only their price.")}
                                okText={t("Validate")}
                                cancelText={t("Cancel")}
                                onConfirm={handOver}
                            >
                                <Button type="primary" icon={<SendOutlined />} loading={handingOver} disabled={!data?.configured.add}>
                                    {t("Validate for pickup ({count})", { count: waiting.length })}
                                </Button>
                            </Popconfirm>
                        )}
                        {canDelete && selected.length > 0 && (
                            <Popconfirm
                                styles={{ root: { maxWidth: 360 } }}
                                title={t("Remove {count} parcel(s)?", { count: selected.length })}
                                description={t("Parcels waiting for pickup are deleted at Colissimo too. Ones Colissimo already has stay.")}
                                okText={t("Remove")}
                                cancelText={t("Cancel")}
                                onConfirm={() => remove(selected)}
                            >
                                <Button danger icon={<DeleteOutlined />}>{t("Remove ({count})", { count: selected.length })}</Button>
                            </Popconfirm>
                        )}
                    </div>
                    <Table
                        rowKey="id"
                        loading={loading}
                        dataSource={rows}
                        columns={columns}
                        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]), getCheckboxProps: (row) => ({ disabled: !canEditParcel(row) && !canRemoveParcel(row) }) }}
                        pagination={{ pageSize: 25, showSizeChanger: false }}
                        scroll={{ x: "max-content" }}
                        // A click on the row (not on its links, buttons or checkbox) opens the parcel's history.
                        onRow={(row) => ({
                            onClick: (e) => {
                                if (row.barcode && !(e.target as HTMLElement).closest("a, button, .ant-table-selection-column, .ant-typography-copy"))
                                    setHistoryFor(row.barcode);
                            },
                            style: row.barcode ? { cursor: "pointer" } : undefined,
                        })}
                        locale={{ emptyText: t("No parcels yet. Click “New parcel”, or open an order and click “Send to Colissimo”.") }}
                    />
                </Space>
            </Card>

            <ParcelHistoryDrawer barcode={historyFor} onClose={() => setHistoryFor(null)} />

            <SendParcelModal
                open={newOpen}
                onClose={() => setNewOpen(false)}
                onSent={() => {
                    setNewOpen(false);
                    load();
                }}
            />

            <EditParcelModal
                delivery={editing}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    load();
                }}
            />

            <Modal
                open={!!handOverResult}
                title={handOverResult?.accepted.length ? t("Handed over to Colissimo") : t("Nothing was handed over")}
                footer={<Button type="primary" onClick={() => setHandOverResult(null)}>{t("OK")}</Button>}
                onCancel={() => setHandOverResult(null)}
            >
                {handOverResult && (
                    <Space orientation="vertical" style={{ width: "100%" }}>
                        {handOverResult.accepted.length > 0 && (
                            <Alert
                                type="success"
                                showIcon
                                title={t("{count} parcel(s) handed over for pickup", { count: handOverResult.accepted.length })}
                                description={handOverResult.manifests.length ? t("Colissimo manifest: {numbers}", { numbers: handOverResult.manifests.join(", ") }) : undefined}
                            />
                        )}
                        {handOverResult.refused.length > 0 && (
                            <Alert
                                type="warning"
                                showIcon
                                title={t("{count} parcel(s) refused", { count: handOverResult.refused.length })}
                                description={
                                    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                                        {handOverResult.refused.map((r) => (
                                            <li key={r.barcode}><Text style={{ fontFamily: "monospace" }}>{r.barcode || "—"}</Text>: {t(r.reason)}</li>
                                        ))}
                                    </ul>
                                }
                            />
                        )}
                    </Space>
                )}
            </Modal>

            <Modal
                open={importOpen}
                title={t("Add a parcel by barcode")}
                okText={t("Add")}
                cancelText={t("Cancel")}
                onOk={importParcel}
                onCancel={() => setImportOpen(false)}
                confirmLoading={importing}
                okButtonProps={{ disabled: barcode.length < 6 }}
            >
                <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                    {t("For parcels created on Colissimo's website. To link one to an order, add it from the order's page.")}
                </Text>
                <Input placeholder={t("Colissimo barcode")} inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/\D/g, ""))} onPressEnter={importParcel} />
            </Modal>
        </div>
    );
}
