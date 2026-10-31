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

/** Colissimo's status wording ("Livré payé", "En cours de livraison", "Rtn définitif"…) → a stage. */
function stageOf(status: string): Stage {
    const s = status.toLowerCase();
    if (s.includes("rtn") || s.includes("retour")) return "returned";
    if (s.includes("supprim") || s.includes("annul")) return "cancelled";
    if (s.includes("livr") && !s.includes("cours")) return "delivered";
    return "in_progress";
}

const isPaid = (status: string) => /pay/i.test(status);

interface DayRow { day: string; count: number; amount: number }

/** Totals of the parcels in the period, and the delivered ones per delivery day. */
function analyse(rows: PortalRow[]) {
    const stages = { delivered: { count: 0, amount: 0 }, returned: { count: 0, amount: 0 }, cancelled: { count: 0, amount: 0 }, in_progress: { count: 0, amount: 0 } };
    const paid = { count: 0, amount: 0 };
    const days = new Map<string, DayRow>();
    let total = 0;
    for (const row of rows) {
        const price = row.price ?? 0;
        const stage = stageOf(row.status);
        stages[stage].count++;
        stages[stage].amount += price;
        if (stage === "cancelled") continue;
        total += price;
        if (stage !== "delivered") continue;
        if (isPaid(row.status)) { paid.count++; paid.amount += price; }
        const day = (row.delivered_at ?? row.added_at ?? "").slice(0, 10) || "—";
        const entry = days.get(day) ?? { day, count: 0, amount: 0 };
        entry.count++;
        entry.amount += price;
        days.set(day, entry);
    }
    return { stages, paid, total, count: rows.length - stages.cancelled.count, perDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)) };
}

/**
 * Admin → Colissimo account (owners): every parcel of the Colissimo account with its status, read
 * live from the shipper's dashboard on Colissimo's website (its API can't list them), and each
 * parcel's details and full history. Colissimo shows at most 2 months at a time.
 */
export default function ColissimoAccountPage() {
    const { t, locale } = useAdminT();
    const money = (n: number) => formatMoney(n, locale);
    const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(30, "day"), dayjs()]);
    const [status, setStatus] = useState("all");
    const [search, setSearch] = useState("");
    const [open, setOpen] = useState<string | null>(null);

    const { data, loading, error, reload } = useApi<PortalList>(
        `/api/owner/colissimo?from=${range[0].format("YYYY-MM-DD")}&to=${range[1].format("YYYY-MM-DD")}`,
    );
    const [syncing, setSyncing] = useState(false);

    const sync = async () => {
        setSyncing(true);
        try {
            const result = await api<{ found: number; added: number }>("/api/owner/colissimo/sync", { method: "POST" });
            message.success(t("{added} new parcel(s) added to Delivery ({found} in the Colissimo account)", result));
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setSyncing(false);
        }
    };

    const counts = useMemo(() => {
        const result = new Map<string, number>();
        for (const row of data?.rows ?? []) result.set(row.status, (result.get(row.status) ?? 0) + 1);
        return [...result].sort((a, b) => b[1] - a[1]);
    }, [data]);

    const stats = useMemo(() => analyse(data?.rows ?? []), [data]);
    const finished = stats.stages.delivered.count + stats.stages.returned.count;

    const rows = useMemo(() => {
        const term = search.trim().toLowerCase();
        return (data?.rows ?? []).filter(
            (row) =>
                (status === "all" || row.status === status) &&
                (!term ||
                    [row.barcode, row.client, row.agency, row.destination_agency, row.driver, row.order?.order_number, ...row.phones].some((v) =>
                        v?.toLowerCase().includes(term),
                    )),
        );
    }, [data, status, search]);

    const columns: ColumnsType<PortalRow> = [
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
        { title: t("Status"), dataIndex: "status", key: "status", render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag> },
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
                subtitle={t("Every parcel of your Colissimo account, read from Colissimo's website. Click a parcel for its history.")}
                extra={
                    <>
                        <DatePicker.RangePicker
                            value={range}
                            allowClear={false}
                            onChange={(value) => value?.[0] && value[1] && setRange([value[0], value[1]])}
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
                            <Button type="primary" icon={<CloudDownloadOutlined />} loading={syncing} disabled={data ? !data.configured : true}>
                                {t("Import all parcels into Delivery")}
                            </Button>
                        </Popconfirm>
                    </>
                }
            />

            {data && !data.configured && (
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

            <Card title={t("Delivered per day")} style={{ marginBottom: 16 }}>
                <Text type="secondary" style={{ display: "block", marginBottom: 12, fontSize: 13 }}>
                    {t("Parcels of the period delivered each day, with the cash Colissimo collected for them. Delivery rate: {rate}%", { rate: percent(stats.stages.delivered.count, finished) ?? 0 })}
                </Text>
                <BarChart
                    data={stats.perDay.map((d) => ({ label: d.day.slice(5), value: d.amount, tooltip: `${formatDate(d.day, locale)}: ${d.count} · ${money(d.amount)}` }))}
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
                                { value: "all", label: `${t("All")} (${data?.rows.length ?? 0})` },
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
