"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, Button, Card, Col, DatePicker, Input, Popconfirm, Row, Segmented, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CloudDownloadOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useAdminT } from "@/lib/admin-i18n";
import { Kpi, PageHeader } from "@/components/admin/erp/ui";
import { BarChart } from "@/components/admin/erp/charts";
import { api, formatDate, formatMoney, percent, useApi } from "@/components/admin/erp/erp-client";
import { message } from "@/components/admin/antd-app";
import ParcelHistoryDrawer, { portalStatusColor as statusColor } from "@/components/admin/delivery/ParcelHistoryDrawer";
import DeliveryStatusTag from "@/components/admin/delivery/DeliveryStatusTag";
import type { Delivery, DeliveryList } from "@/components/admin/delivery/delivery-api";
import { statusInfo } from "@/lib/colissimo-data";

const { Text } = Typography;

interface PortalRow {
    barcode: string;
    client: string;
    phones: string[];
    agency: string | null;
    destination_agency: string | null;
    driver: string | null;
    price: number | null;
    status: string;
    added_at: string | null;
    picked_up_at: string | null;
    delivered_at: string | null;
    order: { id: string; order_number: string } | null;
}

interface PortalList {
    configured: boolean;
    rows: PortalRow[];
}

type Stage = "delivered" | "returned" | "cancelled" | "in_progress";

/** A parcel as this page shows it, from Colissimo's website or from our database. */
interface Row extends PortalRow { stage: Stage; paid: boolean; governorate?: string | null }

interface GovernorateRow { governorate: string; parcels: number; delivered: number; amount: number; returned: number }

/** Parcels, deliveries, money and returns per governorate (our records only: the website's list has none). */
function byGovernorate(rows: Row[]): GovernorateRow[] {
    const map = new Map<string, GovernorateRow>();
    for (const row of rows) {
        if (row.stage === "cancelled") continue;
        const name = row.governorate?.trim() || "—";
        const g = map.get(name) ?? { governorate: name, parcels: 0, delivered: 0, amount: 0, returned: 0 };
        g.parcels++;
        if (row.stage === "delivered") { g.delivered++; g.amount += row.price ?? 0; }
        if (row.stage === "returned") g.returned++;
        map.set(name, g);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/** Colissimo's website wording ("Livré payé", "En cours de livraison", "Rtn définitif"…) → a stage. */
function stageOf(status: string): Stage {
    const s = status.toLowerCase();
    if (s.includes("rtn") || s.includes("retour")) return "returned";
    if (s.includes("supprim") || s.includes("annul")) return "cancelled";
    if ((s.includes("livr") && !s.includes("cours")) || s.includes("change")) return "delivered";
    return "in_progress";
}

const fromPortal = (row: PortalRow): Row => ({ ...row, stage: stageOf(row.status), paid: /pay/i.test(row.status) });

const localTime = (iso: string | null) => (iso ? dayjs(iso).format("YYYY-MM-DD HH:mm") : null);

/** A parcel of our deliveries table, in the same shape (its status spelling: statusInfo()). */
function fromRecord(d: Delivery): Row {
    const group = statusInfo(d.status).group;
    const stage: Stage = d.status === "Supprime" ? "cancelled" : group === "delivered" || group === "returned" ? group : "in_progress";
    return {
        barcode: d.barcode ?? "—",
        client: d.recipient_name || (d.order ? `${d.order.customer_first_name} ${d.order.customer_last_name}`.trim() : ""),
        phones: d.phone ? d.phone.split(" / ") : [],
        agency: null,
        destination_agency: null,
        driver: d.driver_status,
        price: d.cod_amount == null ? null : Number(d.cod_amount),
        status: d.status,
        added_at: localTime(d.created_at),
        picked_up_at: localTime(d.handed_over_at),
        delivered_at: stage === "delivered" ? localTime(d.status_changed_at) : null,
        order: d.order ? { id: d.order.id, order_number: d.order.order_number } : null,
        governorate: d.governorate,
        stage,
        paid: stage === "delivered" && (d.paid || d.status === "Livre paye"),
    };
}

interface DayRow { day: string; count: number; amount: number }

/** Totals of the parcels in the period, and the delivered ones per delivery day. */
function analyse(rows: Row[]) {
    const stages = { delivered: { count: 0, amount: 0 }, returned: { count: 0, amount: 0 }, cancelled: { count: 0, amount: 0 }, in_progress: { count: 0, amount: 0 } };
    const paid = { count: 0, amount: 0 };
    const days = new Map<string, DayRow>();
    let total = 0;
    for (const row of rows) {
        const price = row.price ?? 0;
        const stage = row.stage;
        stages[stage].count++;
        stages[stage].amount += price;
        if (stage === "cancelled") continue;
        total += price;
        if (stage !== "delivered") continue;
        if (row.paid) { paid.count++; paid.amount += price; }
        const day = (row.delivered_at ?? row.added_at ?? "").slice(0, 10) || "—";
        const entry = days.get(day) ?? { day, count: 0, amount: 0 };
        entry.count++;
        entry.amount += price;
        days.set(day, entry);
    }
    return { stages, paid, total, count: rows.length - stages.cancelled.count, perDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)) };
}

/**
 * Admin → Colissimo account (owners): every parcel with its status, money and returns, and the
 * delivered ones per day. By default from our own records (the deliveries table: every parcel
 * since the start, old imports included, any dates). "Live from Colissimo" reads the shipper's
 * dashboard on Colissimo's website instead, at most 2 months at a time, to check our records.
 * Clicking a parcel shows its full history from Colissimo's website.
 */
export default function ColissimoAccountPage() {
    const { t, locale } = useAdminT();
    const money = (n: number) => formatMoney(n, locale);
    const [source, setSource] = useState<"records" | "live">("records");
    // null: since the start (our records); Colissimo's website needs dates, the last 30 days by default.
    const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
    const liveRange = range ?? [dayjs().subtract(30, "day"), dayjs()];
    const [status, setStatus] = useState("all");
    const [search, setSearch] = useState("");
    const [open, setOpen] = useState<string | null>(null);

    const live = useApi<PortalList>(
        source === "live" ? `/api/owner/colissimo?from=${liveRange[0].format("YYYY-MM-DD")}&to=${liveRange[1].format("YYYY-MM-DD")}` : null,
    );
    const records = useApi<DeliveryList>(source === "records" ? "/api/delivery" : null);
    const { loading, error, reload } = source === "live" ? live : records;
    const all = useMemo<Row[]>(() => {
        if (source === "live") return (live.data?.rows ?? []).map(fromPortal);
        const from = range?.[0].format("YYYY-MM-DD") ?? "";
        const to = range?.[1].format("YYYY-MM-DD") ?? "9999";
        return (records.data?.rows ?? []).map(fromRecord).filter((row) => {
            const day = (row.added_at ?? "").slice(0, 10);
            return day >= from && day <= to;
        });
    }, [source, live.data, records.data, range]);
    const [syncing, setSyncing] = useState(false);

    const sync = async () => {
        setSyncing(true);
        try {
            const result = await api<{ found: number; added: number; updated: number; archived: number }>("/api/owner/colissimo/sync", { method: "POST" });
            message.success(t("{added} new parcel(s) added to Delivery ({found} in the Colissimo account)", result));
            if (result.updated) message.info(t("{updated} parcel status(es) updated from Colissimo", result));
            if (result.archived) message.info(t("{archived} old parcel(s) marked as old order, status unknown", result));
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setSyncing(false);
        }
    };

    const counts = useMemo(() => {
        const result = new Map<string, number>();
        for (const row of all) result.set(row.status, (result.get(row.status) ?? 0) + 1);
        return [...result].sort((a, b) => b[1] - a[1]);
    }, [all]);

    const stats = useMemo(() => analyse(all), [all]);
    const governorates = useMemo(() => (source === "records" ? byGovernorate(all) : []), [all, source]);
    const finished = stats.stages.delivered.count + stats.stages.returned.count;
    // Over 3 months, one bar per month (the table below stays per day).
    const chart = useMemo(() => {
        if (stats.perDay.length <= 92) return stats.perDay.map((d) => ({ label: d.day.slice(5), value: d.amount, tooltip: `${formatDate(d.day, locale)}: ${d.count} · ${money(d.amount)}` }));
        const months = new Map<string, DayRow>();
        for (const d of stats.perDay) {
            const m = months.get(d.day.slice(0, 7)) ?? { day: d.day.slice(0, 7), count: 0, amount: 0 };
            m.count += d.count;
            m.amount += d.amount;
            months.set(m.day, m);
        }
        return [...months.values()].map((m) => ({ label: m.day.slice(2), value: m.amount, tooltip: `${m.day}: ${m.count} · ${money(m.amount)}` }));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- money/locale only change the labels' language
    }, [stats]);

    const rows = useMemo(() => {
        const term = search.trim().toLowerCase();
        return all.filter(
            (row) =>
                (status === "all" || row.status === status) &&
                (!term ||
                    [row.barcode, row.client, row.agency, row.destination_agency, row.driver, row.order?.order_number, ...row.phones].some((v) =>
                        v?.toLowerCase().includes(term),
                    )),
        );
    }, [all, status, search]);

    const columns: ColumnsType<Row> = [
        {
            title: t("Barcode / order"),
            key: "barcode",
            render: (_, row) => (
                <div>
                    <Text copyable style={{ fontFamily: "monospace" }}>{row.barcode}</Text>
                    <div style={{ fontSize: 12 }}>
                        {row.order ? (
                            <Link href={`/admin/orders/${row.order.id}`} onClick={(e) => e.stopPropagation()} style={{ fontFamily: "monospace" }}>
                                {row.order.order_number}
                            </Link>
                        ) : (
                            <Text type="secondary">{t("Not linked")}</Text>
                        )}
                    </div>
                </div>
            ),
        },
        {
            title: t("Customer"),
            key: "client",
            render: (_, row) => (
                <div>
                    <div style={{ fontWeight: 500 }}>{row.client || "—"}</div>
                    {row.phones.length > 0 && <Text type="secondary" style={{ fontSize: 12 }}>{row.phones.join(" / ")}</Text>}
                </div>
            ),
        },
        {
            title: t("Agency"),
            key: "agency",
            render: (_, row) => [row.agency, row.destination_agency].filter(Boolean).join(" → ") || "—",
        },
        { title: t("Driver"), dataIndex: "driver", key: "driver", render: (value: string | null) => value ?? "—" },
        {
            title: t("Cash to collect"),
            dataIndex: "price",
            key: "price",
            sorter: (a, b) => (a.price ?? 0) - (b.price ?? 0),
            render: (value: number | null) => (value != null ? `${value} TND` : "—"),
        },
        {
            title: t("Status"),
            dataIndex: "status",
            key: "status",
            render: (value: string) => (source === "records" ? <DeliveryStatusTag status={value} /> : <Tag color={statusColor(value)}>{value}</Tag>),
        },
        {
            title: t("Added"),
            dataIndex: "added_at",
            key: "added_at",
            defaultSortOrder: "descend",
            sorter: (a, b) => (a.added_at ?? "").localeCompare(b.added_at ?? ""),
            render: (value: string | null) => value ?? "—",
        },
        { title: t("Picked up"), dataIndex: "picked_up_at", key: "picked_up_at", render: (value: string | null) => value ?? "—" },
        { title: t("Delivered"), dataIndex: "delivered_at", key: "delivered_at", render: (value: string | null) => value ?? "—" },
    ];

    return (
        <div>
            <PageHeader
                title={t("Colissimo account")}
                subtitle={
                    source === "records"
                        ? t("Every parcel since the start, from your records. Click a parcel for its history at Colissimo.")
                        : t("Live from Colissimo's website (2 months at most), to check your records. Click a parcel for its history.")
                }
                extra={
                    <>
                        <Segmented
                            value={source}
                            onChange={(value) => { setSource(value as "records" | "live"); setStatus("all"); }}
                            options={[{ value: "records", label: t("My records") }, { value: "live", label: t("Live from Colissimo") }]}
                        />
                        <DatePicker.RangePicker
                            value={source === "live" ? liveRange : range}
                            allowClear={source === "records"}
                            placeholder={[t("Since the start"), t("to")]}
                            onChange={(value) => setRange(value?.[0] && value[1] ? [value[0], value[1]] : null)}
                            disabledDate={(day) => day.isAfter(dayjs(), "day")}
                        />
                        <Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>{t("Refresh")}</Button>
                        <Popconfirm
                            styles={{ root: { maxWidth: 360 } }}
                            title={t("Add every parcel of the Colissimo account to Delivery?")}
                            description={t("Only the ones Delivery doesn't have yet. Staff can then search them all and open their history.")}
                            okText={t("Import")}
                            cancelText={t("Cancel")}
                            onConfirm={sync}
                        >
                            <Button type="primary" icon={<CloudDownloadOutlined />} loading={syncing}>
                                {t("Import all parcels into Delivery")}
                            </Button>
                        </Popconfirm>
                    </>
                }
            />

            {live.data && !live.data.configured && (
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    title={t("Your Colissimo website login isn't set")}
                    description={t("Add COLISSIMO_PORTAL_USER and COLISSIMO_PORTAL_PASSWORD (your colissimodelivery.tn login) to the server environment.")}
                />
            )}
            {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} title={t(error)} />}

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={12} md={8} xl={4}>
                    <Kpi loading={loading} title={t("Parcels sent")} value={stats.count} sub={money(stats.total)} />
                </Col>
                <Col xs={12} md={8} xl={4}>
                    <Kpi loading={loading} color="#008300" title={t("Delivered")} value={stats.stages.delivered.count} sub={money(stats.stages.delivered.amount)} />
                </Col>
                <Col xs={12} md={8} xl={4}>
                    <Kpi loading={loading} title={t("Delivered and paid")} value={stats.paid.count} sub={money(stats.paid.amount)} hint={t("Colissimo marks the cash as paid to you")} />
                </Col>
                <Col xs={12} md={8} xl={4}>
                    <Kpi loading={loading} title={t("Cash still with Colissimo")} value={money(stats.stages.delivered.amount - stats.paid.amount)} sub={t("{count} parcel(s)", { count: stats.stages.delivered.count - stats.paid.count })} />
                </Col>
                <Col xs={12} md={8} xl={4}>
                    <Kpi loading={loading} color="#d4380d" title={t("Returned")} value={stats.stages.returned.count} sub={`${money(stats.stages.returned.amount)} · ${percent(stats.stages.returned.count, finished) ?? 0}%`} />
                </Col>
                <Col xs={12} md={8} xl={4}>
                    <Kpi loading={loading} title={t("In progress")} value={stats.stages.in_progress.count} sub={money(stats.stages.in_progress.amount)} />
                </Col>
            </Row>

            {governorates.length > 0 && (
                <Card title={t("By governorate")} style={{ marginBottom: 16 }}>
                    <Table
                        rowKey="governorate"
                        size="small"
                        dataSource={governorates}
                        pagination={{ pageSize: 24, showSizeChanger: false, hideOnSinglePage: true }}
                        scroll={{ x: "max-content" }}
                        columns={[
                            { title: t("Governorate"), dataIndex: "governorate", key: "governorate" },
                            { title: t("Parcels"), dataIndex: "parcels", key: "parcels", align: "right", sorter: (a, b) => a.parcels - b.parcels },
                            { title: t("Delivered"), dataIndex: "delivered", key: "delivered", align: "right", sorter: (a, b) => a.delivered - b.delivered },
                            { title: t("Amount"), dataIndex: "amount", key: "amount", align: "right", defaultSortOrder: "descend", sorter: (a, b) => a.amount - b.amount, render: (v: number) => money(v) },
                            { title: t("Returned"), dataIndex: "returned", key: "returned", align: "right", sorter: (a, b) => a.returned - b.returned },
                            {
                                title: t("Return rate"),
                                key: "rate",
                                align: "right",
                                sorter: (a, b) => (percent(a.returned, a.delivered + a.returned) ?? 0) - (percent(b.returned, b.delivered + b.returned) ?? 0),
                                render: (_, g) => {
                                    const rate = percent(g.returned, g.delivered + g.returned);
                                    return rate === null ? "—" : <Text type={rate >= 30 ? "danger" : undefined}>{rate}%</Text>;
                                },
                            },
                        ]}
                    />
                </Card>
            )}

            <Card title={t("Delivered per day")} style={{ marginBottom: 16 }}>
                <Text type="secondary" style={{ display: "block", marginBottom: 12, fontSize: 13 }}>
                    {t("Parcels of the period delivered each day, with the cash Colissimo collected for them. Delivery rate: {rate}%", { rate: percent(stats.stages.delivered.count, finished) ?? 0 })}
                </Text>
                <BarChart
                    data={chart}
                    color="#008300"
                />
                <Table
                    rowKey="day"
                    size="small"
                    style={{ marginTop: 16 }}
                    dataSource={[...stats.perDay].reverse()}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    columns={[
                        { title: t("Date"), dataIndex: "day", key: "day", render: (value: string) => formatDate(value, locale) },
                        { title: t("Delivered orders"), dataIndex: "count", key: "count", align: "right" },
                        { title: t("Amount"), dataIndex: "amount", key: "amount", align: "right", render: (value: number) => money(value) },
                    ]}
                    summary={() => (
                        <Table.Summary.Row>
                            <Table.Summary.Cell index={0}><Text strong>{t("Total")}</Text></Table.Summary.Cell>
                            <Table.Summary.Cell index={1} align="right"><Text strong>{stats.stages.delivered.count}</Text></Table.Summary.Cell>
                            <Table.Summary.Cell index={2} align="right"><Text strong>{money(stats.stages.delivered.amount)}</Text></Table.Summary.Cell>
                        </Table.Summary.Row>
                    )}
                />
            </Card>

            <Card>
                <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                    <div style={{ overflowX: "auto" }}>
                        <Segmented
                            value={status}
                            onChange={(value) => setStatus(String(value))}
                            options={[
                                { value: "all", label: `${t("All")} (${all.length})` },
                                ...counts.map(([name, count]) => ({ value: name, label: `${name} (${count})` })),
                            ]}
                        />
                    </div>
                    <Input
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder={t("Search barcode, order, customer, phone, driver")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ maxWidth: 360 }}
                    />
                    <Table
                        rowKey="barcode"
                        loading={loading}
                        dataSource={rows}
                        columns={columns}
                        size="small"
                        pagination={{ pageSize: 50, showSizeChanger: false }}
                        scroll={{ x: "max-content" }}
                        onRow={(row) => ({ onClick: () => setOpen(row.barcode), style: { cursor: "pointer" } })}
                    />
                </Space>
            </Card>

            <ParcelHistoryDrawer barcode={open} onClose={() => setOpen(null)} />
        </div>
    );
}
