"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { printSlips } from "@/components/admin/delivery/print-slips";
import { Alert, Breadcrumb, Button, Card, DatePicker, Input, Modal, Popconfirm, Select, Space, Table, Tooltip, Typography } from "antd";
import type { Dayjs } from "dayjs";
import type { ColumnsType } from "antd/es/table";
import { BarcodeOutlined, DeleteOutlined, EditOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined, SendOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminRole } from "@/lib/admin-role-context";
import { DATE_LOCALES, useAdminT } from "@/lib/admin-i18n";
import StatusCards, { statusesOfCard } from "@/components/admin/delivery/StatusCards";
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
    type DeliveryPageData,
    type HandOverResult,
    type RefreshResult,
    type RemoveResult,
} from "@/components/admin/delivery/delivery-api";

const { Title, Text } = Typography;

// "all", or a status card's key (StatusCards: Colissimo's dashboard, status by status).
type Filter = string;
const PAGE_SIZE = 25;

/**
 * Admin → Delivery: the parcels sent to Colissimo from the orders (or added by barcode), with
 * their live status (checked automatically every 15 minutes). Parcels waiting for pickup are
 * handed over in one click (Colissimo's manifest), edited, or deleted at Colissimo. Its API
 * can't list an account's parcels, so parcels created on its website appear once added by barcode.
 */
export default function DeliveryPage() {
    const { t, locale } = useAdminT();
    const { can, isAdmin: showMoney } = useAdminRole(); // money (amounts, totals): owners and admins only
    const canDelete = can("delete");
    const [data, setData] = useState<DeliveryPageData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [filter, setFilter] = useState<Filter>("all");
    const [page, setPage] = useState(1);
    const [lastChange, setLastChange] = useState<"asc" | "desc" | null>(null); // sort of the "Last change" column
    const [search, setSearch] = useState("");
    const [query, setQuery] = useState(""); // the search sent to the server, a moment after typing stops
    useEffect(() => {
        const timer = setTimeout(() => {
            setQuery(search.trim());
            setPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);
    // Parcels sent from this system, or imported from Colissimo's website (orders COL-<barcode>).
    const [source, setSource] = useState<"all" | "system" | "imported">("all");
    const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
    // Kept across pages: antd passes back the rows ticked on other pages too.
    const [selectedRows, setSelectedRows] = useState<Delivery[]>([]);
    const selected = selectedRows.map((row) => row.id);
    // Ticked parcels: any with a barcode prints its slip; only some can be removed (canRemoveParcel).
    const printable = selectedRows.flatMap((row) => (row.barcode ? [row.barcode] : []));
    const removable = selectedRows.filter(canRemoveParcel).map((row) => row.id);
    const [importOpen, setImportOpen] = useState(false);
    const [barcode, setBarcode] = useState("");
    const [importing, setImporting] = useState(false);
    const [newOpen, setNewOpen] = useState(false);
    const [editing, setEditing] = useState<Delivery | null>(null);
    const [historyFor, setHistoryFor] = useState<string | null>(null);
    const [handingOver, setHandingOver] = useState(false);
    const [handOverResult, setHandOverResult] = useState<HandOverResult | null>(null);

    const latestLoad = useRef(0);
    const byStatusRef = useRef<{ status: string }[]>([]); // the "Other" card's statuses, from the last load
    const load = useCallback(async () => {
        const loadId = ++latestLoad.current;
        setLoading(true);
        const params = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE), tab: "all", source });
        // A status card: its statuses (a card with none yet matches nothing, not everything).
        if (filter !== "all") params.append("statuses", statusesOfCard(filter, byStatusRef.current).join(",") || "-");
        if (query) params.append("q", query);
        if (range?.[0]) params.append("from", range[0].format("YYYY-MM-DD"));
        if (range?.[1]) params.append("to", range[1].format("YYYY-MM-DD"));
        if (lastChange) {
            params.append("sort", "changed");
            params.append("dir", lastChange);
        }
        try {
            const result = await deliveryApi<DeliveryPageData>({ query: params.toString() });
            if (loadId !== latestLoad.current) return; // a newer search or page took over
            byStatusRef.current = result.by_status;
            setData(result);
            // The last page emptied by a removal: go back to the new last one.
            if (!result.rows.length && result.total > 0 && page > 1) setPage(Math.ceil(result.total / PAGE_SIZE));
        } catch (e) {
            message.error((e as Error).message);
        } finally {
            if (loadId === latestLoad.current) setLoading(false);
        }
    }, [page, filter, source, query, range, lastChange]);

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
            setSelectedRows([]);
            await load();
        } catch (e) {
            message.error((e as Error).message);
        }
    };

    // The ticked parcels Colissimo can take in a manifest, or with none ticked all those shown, on any page.
    const ticked = selectedRows.filter(canEditParcel);
    const waiting = ticked.length ? ticked.map((row) => row.id) : data?.waiting ?? [];

    const handOver = async () => {
        setHandingOver(true);
        try {
            const result = await deliveryApi<HandOverResult>({ method: "POST", body: { action: "handover", ids: waiting } });
            setHandOverResult(result);
            setSelectedRows([]);
            await load();
        } catch (e) {
            message.error((e as Error).message);
        } finally {
            setHandingOver(false);
        }
    };

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
        // Owners and admins only: the server sends no amounts to staff (its by_status has none then).
        ...(showMoney
            ? [{
                title: t("Cash to collect"),
                dataIndex: "cod_amount",
                key: "cod_amount",
                render: (value: number | null) => (value != null ? `${Number(value)} TND` : "—"),
            }]
            : []),
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
            sorter: true,
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
                    {row.barcode && (
                        <Tooltip title={t("Slip")}>
                            <Button type="link" size="small" icon={<PrinterOutlined />} onClick={() => printSlips(`codes=${row.barcode}`)} aria-label={t("Slip")} />
                        </Tooltip>
                    )}
                    {row.barcode && (
                        <Tooltip title={t("Check")}>
                            <Button type="link" size="small" icon={<ReloadOutlined />} onClick={() => refreshStatuses([row.id])} aria-label={t("Check")} />
                        </Tooltip>
                    )}
                    {/* Staff get no amounts here (the form would start at 0): they edit from the order's page. */}
                    {canEditParcel(row) && showMoney && (
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
                    <StatusCards
                        byStatus={data?.by_status ?? []}
                        selected={filter}
                        showMoney={showMoney}
                        onSelect={(key) => { setFilter(key); setPage(1); }}
                    />
                    <div>
                        <Button type={filter === "all" ? "primary" : "default"} onClick={() => { setFilter("all"); setPage(1); }}>
                            {t("All parcels")} ({data?.counts.all ?? 0})
                        </Button>
                    </div>
                    <div className="admin-filters" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                        <Input
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder={t("Search barcode, order, customer, phone, city")}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ maxWidth: 360 }}
                        />
                        <DatePicker.RangePicker value={range} onChange={(value) => { setRange(value); setPage(1); }} placeholder={[t("Sent from"), t("to")]} allowEmpty={[true, true]} />
                        <Select
                            value={source}
                            onChange={(value) => { setSource(value); setPage(1); }}
                            style={{ width: 210 }}
                            options={[
                                { value: "all", label: t("All parcels") },
                                { value: "system", label: t("Sent from this system") },
                                { value: "imported", label: t("Imported from Colissimo") },
                            ]}
                        />
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
                        {printable.length > 0 && (
                            <Button icon={<PrinterOutlined />} onClick={() => printSlips(`codes=${printable.join(",")}`)}>
                                {t("Print slips ({count})", { count: printable.length })}
                            </Button>
                        )}
                        {canDelete && removable.length > 0 && (
                            <Popconfirm
                                styles={{ root: { maxWidth: 360 } }}
                                title={t("Remove {count} parcel(s)?", { count: removable.length })}
                                description={t("Parcels waiting for pickup are deleted at Colissimo too. Ones Colissimo already has stay.")}
                                okText={t("Remove")}
                                cancelText={t("Cancel")}
                                onConfirm={() => remove(removable)}
                            >
                                <Button danger icon={<DeleteOutlined />}>{t("Remove ({count})", { count: removable.length })}</Button>
                            </Popconfirm>
                        )}
                    </div>
                    <Table
                        rowKey="id"
                        loading={loading}
                        dataSource={data?.rows}
                        columns={columns}
                        rowSelection={{ selectedRowKeys: selected, preserveSelectedRowKeys: true, onChange: (_keys, rows) => setSelectedRows(rows), getCheckboxProps: (row) => ({ disabled: !row.barcode && !canRemoveParcel(row) }) }}
                        pagination={{ current: page, pageSize: PAGE_SIZE, total: data?.total ?? 0, showSizeChanger: false }}
                        onChange={(pagination, _filters, sorter) => {
                            setPage(pagination.current ?? 1);
                            const by = Array.isArray(sorter) ? sorter[0] : sorter;
                            setLastChange(by?.order ? (by.order === "ascend" ? "asc" : "desc") : null);
                        }}
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
