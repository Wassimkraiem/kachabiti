"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Badge,
    Breadcrumb,
    Button,
    Card,
    DatePicker,
    Image,
    Input,
    Popconfirm,
    Select,
    Space,
    Table,
    Tag,
    Tooltip,
    Typography,
} from "antd";
import { message } from "@/components/admin/antd-app";
import { ORDER_ITEM_IMAGE_FALLBACK, ORDER_STATUS_COLORS, ORDER_STATUS_OPTIONS, PAYMENT_STATUS_COLORS, PAYMENT_STATUS_LABELS, errorCode, orderStatusLabel, validateOrder } from "@/components/admin/order-status";
import { AgentSelect, ChannelTag, useTeam } from "@/components/admin/erp/ui";
import { api } from "@/components/admin/erp/erp-client";
import { CHANNELS, CHANNEL_LABELS, OPEN_ORDER_STATUSES } from "@/lib/erp/constants";
import { useAdminRole } from "@/lib/admin-role-context";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import {
    DeleteOutlined,
    EyeOutlined,
    CarOutlined,
    UserOutlined,
    SearchOutlined,
    ReloadOutlined,
    PlusOutlined,
    CheckOutlined,
    WarningOutlined,
    UserAddOutlined,
    PrinterOutlined,
} from "@ant-design/icons";
import { DATE_LOCALES, useAdminT } from "@/lib/admin-i18n";
import DeliveryStatusTag from "@/components/admin/delivery/DeliveryStatusTag";
import { reportParcelCancellation } from "@/components/admin/delivery/delivery-api";

const { Title, Text } = Typography;

interface OrderRow {
    id: string;
    order_number: string;
    customer_first_name: string;
    customer_last_name: string;
    customer_email: string;
    customer_phone: string;
    total: number;
    status: string;
    payment_status: string;
    created_at: string;
    items?: { id: string; product_name: string; product_image: string | null; quantity: number; variant_label: string | null }[];
    deliveries?: { status: string; barcode: string | null }[];
    created_by?: string | null;
    created_by_email?: string | null;
    channel: string;
    assigned_to: string | null;
    assigned_to_email: string | null;
    paid_amount: number;
}

/** Last 8 digits of a phone, to spot the same customer ordering twice. */
const phoneKey = (phone: string | null | undefined) => (phone ?? "").replace(/\D/g, "").slice(-8);

export default function AdminOrdersPage() {
    const { t, locale } = useAdminT();
    const { can, id: myId, isAdmin } = useAdminRole();
    const canDelete = can("delete");
    const team = useTeam();
    const [channelFilter, setChannelFilter] = useState<string>("all");
    const [assignTo, setAssignTo] = useState<string | null>(null);
    const router = useRouter();
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [loading, setLoading] = useState(true); // first fetch starts on mount: show the table spinner right away
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
    const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>("all");
    // Who handles the order: "all", "me", "none" (nobody yet), "website" (customers, no agent) or an
    // agent's user id (?added_by= from Agent performance, ?assigned=none from My day; ?status= too).
    const [addedByFilter, setAddedByFilter] = useState<string>("all");
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const handledBy = params.get("added_by") ?? params.get("assigned");
        if (handledBy) setAddedByFilter(handledBy);
        if (params.get("status")) setStatusFilter(params.get("status")!);
    }, []);
    const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
    const [bulkDeleting, setBulkDeleting] = useState(false);

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter !== 'all') {
                params.append('status', statusFilter);
            }
            if (range?.[0]) params.append('from', range[0].format('YYYY-MM-DD'));
            if (range?.[1]) params.append('to', range[1].format('YYYY-MM-DD'));

            const response = await fetch(`/api/orders?${params.toString()}`);

            if (!response.ok) {
                const text = await response.text();
                console.error("API Error:", response.status, text);
                message.error(t("Failed to load orders: {status}", { status: response.status }));
                return;
            }

            const result = await response.json();
            if (result.success) {
                setOrders(result.data || []);
            } else {
                message.error(result.error || t("Unable to load orders"));
            }
        } catch (error: any) {
            console.error("Fetch error:", error);
            message.error(t("Failed to fetch orders: {error}", { error: error.message || t("Unknown error") }));
        } finally {
            setLoading(false);
        }
    }, [statusFilter, range]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    const filteredOrders = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return orders.filter((order) => {
            // Email is optional, so it can be null.
            const matchesSearch = [order.order_number, order.customer_first_name, order.customer_last_name, order.customer_email, order.customer_phone, order.created_by_email, order.deliveries?.[0]?.barcode]
                .some((value) => (value ?? "").toLowerCase().includes(term));

            const matchesPaymentStatus =
                paymentStatusFilter === "all" ? true : order.payment_status === paymentStatusFilter;

            const handler = order.assigned_to ?? order.created_by ?? null;
            const matchesAddedBy =
                addedByFilter === "all" ? true
                    : addedByFilter === "website" ? !order.created_by
                        : addedByFilter === "none" ? !handler
                            : addedByFilter === "me" ? handler === myId
                                : handler === addedByFilter;

            const matchesChannel = channelFilter === "all" || order.channel === channelFilter;

            return matchesSearch && matchesPaymentStatus && matchesAddedBy && matchesChannel;
        });
    }, [orders, searchTerm, paymentStatusFilter, addedByFilter, channelFilter, myId]);

    // Team members for the "Handled by" filter (plus an agent from the URL who left the team).
    const agentOptions = useMemo(() => {
        const agents = new Map<string, string>(team.map((m) => [m.user_id, m.email ?? m.user_id]));
        if (!["all", "website", "none", "me"].includes(addedByFilter) && !agents.has(addedByFilter)) agents.set(addedByFilter, t("Selected agent"));
        return [...agents].map(([value, label]) => ({ value, label }));
    }, [team, addedByFilter, t]);

    // Orders in progress that share a phone with another order in progress: possible duplicates.
    const duplicates = useMemo(() => {
        const byPhone = new Map<string, OrderRow[]>();
        for (const order of orders) {
            const key = phoneKey(order.customer_phone);
            if (key.length < 8 || !(OPEN_ORDER_STATUSES as readonly string[]).includes(order.status)) continue;
            byPhone.set(key, [...(byPhone.get(key) ?? []), order]);
        }
        return byPhone;
    }, [orders]);
    const duplicatesOf = (order: OrderRow) => (duplicates.get(phoneKey(order.customer_phone)) ?? []).filter((o) => o.id !== order.id);

    const runAction = async (body: Record<string, unknown>, done: string) => {
        try {
            const result = await api<{ changed?: number; confirmed?: number }>("/api/sales/orders", { method: "PATCH", body });
            message.success(t(done, { count: result.changed ?? result.confirmed ?? 0 }));
            setSelectedRowKeys([]);
            fetchOrders();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const formatPrice = (price: number) => {
        return `${Number(price).toFixed(3)} DT`;
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString(DATE_LOCALES[locale], {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const [validatingId, setValidatingId] = useState<string | null>(null);
    const handleValidate = async (order: OrderRow) => {
        setValidatingId(order.id);
        try {
            const result = await validateOrder(order.id);
            if (result.delivery?.barcode) {
                message.success(t("Order {order_number} validated, Colissimo parcel {barcode}", { order_number: order.order_number, barcode: result.delivery.barcode }));
            } else {
                message.success(t("Order {order_number} validated", { order_number: order.order_number }));
            }
            if (result.warning) message.warning(t(result.warning));
            if (result.delivery?.label_url) router.push(`/admin/delivery/print?orders=${order.id}`);
            else fetchOrders();
        } catch (e) {
            if (errorCode(e) === "NEEDS_DETAILS") {
                // Missing delivery details: finish them in the send form on the order's page.
                message.info(t("Complete the delivery details to validate this order"));
                router.push(`/admin/orders/${order.id}?send=1`);
                return;
            }
            message.error(t((e as Error).message));
        } finally {
            setValidatingId(null);
        }
    };

    // Validates the selected orders still to validate, one by one, then opens their slips to print.
    const [bulkValidating, setBulkValidating] = useState(false);
    const toValidate = orders.filter((o) => selectedRowKeys.includes(o.id) && (o.status === "pending" || o.status === "confirmed"));
    const handleBulkValidate = async () => {
        setBulkValidating(true);
        const validated: string[] = [];
        for (const order of toValidate) {
            try {
                const result = await validateOrder(order.id);
                if (result.warning) message.warning(t(result.warning));
                validated.push(order.id);
            } catch (e) {
                message.error(`${order.order_number}: ${errorCode(e) === "NEEDS_DETAILS" ? t("Complete the delivery details to validate this order") : t((e as Error).message)}`);
            }
        }
        setBulkValidating(false);
        if (validated.length > 0) {
            message.success(t("Validated {count} order(s)", { count: validated.length }));
            router.push(`/admin/delivery/print?orders=${validated.join(",")}`);
        } else fetchOrders();
    };

    const handleDelete = async (order: OrderRow) => {
        try {
            const response = await fetch(`/api/orders?id=${order.id}`, {
                method: "DELETE",
            });

            const result = await response.json();
            if (result.success) {
                message.success(t("Deleted order {order_number}", { order_number: order.order_number }));
                reportParcelCancellation(result.data?.parcels, message, t);
                fetchOrders();
            } else {
                message.error(result.error || t("Unable to delete order"));
            }
        } catch (error: any) {
            console.error("Delete error:", error);
            message.error(t("Failed to delete order: {error}", { error: error.message || t("Unknown error") }));
        }
    };

    const handleBulkDelete = async () => {
        if (selectedRowKeys.length === 0) {
            message.warning(t("No orders selected"));
            return;
        }

        setBulkDeleting(true);
        try {
            // One request: the server deletes all selected orders in a single transaction, or none.
            const response = await fetch(`/api/orders?ids=${selectedRowKeys.join(",")}`, { method: "DELETE" });
            const result = await response.json().catch(() => null);
            if (!response.ok || !result?.success) {
                throw new Error(result?.error || "Delete failed");
            }
            const successCount = selectedRowKeys.length;
            const failCount = 0;
            reportParcelCancellation(result.data?.parcels, message, t);

            if (successCount > 0) {
                message.success(t("Successfully deleted {count} order(s)", { count: successCount }));
            }
            if (failCount > 0) {
                message.error(t("Failed to delete {count} order(s)", { count: failCount }));
            }

            setSelectedRowKeys([]);
            fetchOrders();
        } catch (error: any) {
            console.error("Bulk delete error:", error);
            message.error(t("Failed to delete orders: {error}", { error: error.message || t("Unknown error") }));
        } finally {
            setBulkDeleting(false);
        }
    };

    const columns: ColumnsType<OrderRow> = [
        {
            title: t("Order #"),
            dataIndex: "order_number",
            key: "order_number",
            sorter: (a, b) => a.order_number.localeCompare(b.order_number),
            render: (orderNumber: string) => (
                <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{orderNumber}</span>
            ),
        },
        {
            title: t("Customer"),
            key: "customer",
            render: (_: any, record: OrderRow) => (
                <div>
                    <div style={{ fontWeight: 500 }}>
                        {record.customer_first_name} {record.customer_last_name}
                    </div>
                    <div style={{ fontSize: 12, color: "#999" }}>{record.customer_phone}{record.customer_email ? ` · ${record.customer_email}` : ""}</div>
                    <Space size={4} wrap style={{ marginTop: 4 }}>
                        <ChannelTag channel={record.channel} />
                        {record.assigned_to_email || record.created_by_email ? (
                            <Tag icon={<UserOutlined />}>{record.assigned_to_email ?? record.created_by_email}</Tag>
                        ) : (OPEN_ORDER_STATUSES as readonly string[]).includes(record.status) && (
                            <Button size="small" type="dashed" icon={<UserAddOutlined />} onClick={() => runAction({ action: "assign", ids: [record.id], user_id: myId }, "Assigned {count} order(s)")}>
                                {t("Take it")}
                            </Button>
                        )}
                        {duplicatesOf(record).length > 0 && (
                            <Tooltip title={t("Same phone as {orders}", { orders: duplicatesOf(record).map((o) => o.order_number).join(", ") })}>
                                <Tag color="red" icon={<WarningOutlined />}>{t("Possible duplicate")}</Tag>
                            </Tooltip>
                        )}
                    </Space>
                </div>
            ),
        },
        {
            title: t("Products"),
            key: "items",
            render: (_: any, record: OrderRow) => {
                const items = record.items ?? [];
                const shown = items.slice(0, 3);
                // Orders imported from Colissimo's website: its list doesn't say what was inside.
                if (items.length === 0)
                    return <Text type="secondary" style={{ fontSize: 12 }}>{record.order_number.startsWith("COL-") ? t("Imported from Colissimo") : "—"}</Text>;
                return (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap" }}>
                        {shown.map((item) => (
                            <Tooltip key={item.id} title={`${item.quantity} × ${item.product_name}${item.variant_label ? ` (${item.variant_label})` : ""}`}>
                                <Badge count={item.quantity > 1 ? item.quantity : 0} size="small" color="#7a3b2e">
                                    <Image
                                        src={item.product_image || undefined}
                                        alt={item.product_name}
                                        width={40}
                                        height={40}
                                        preview={false}
                                        fallback={ORDER_ITEM_IMAGE_FALLBACK}
                                        style={{ objectFit: "cover", objectPosition: "top", borderRadius: 6, border: "1px solid #f0f0f0" }}
                                    />
                                </Badge>
                            </Tooltip>
                        ))}
                        {items.length > shown.length && <Text type="secondary">+{items.length - shown.length}</Text>}
                    </div>
                );
            },
        },
        {
            title: t("Total"),
            dataIndex: "total",
            key: "total",
            sorter: (a, b) => a.total - b.total,
            render: (total: number) => formatPrice(total),
        },
        {
            title: t("Status"),
            dataIndex: "status",
            key: "status",
            sorter: (a, b) => a.status.localeCompare(b.status),
            render: (status: string, record: OrderRow) => (
                <Space orientation="vertical" size={4}>
                    <Tag color={ORDER_STATUS_COLORS[status] || "default"}>{t(orderStatusLabel(status))}</Tag>
                    {record.deliveries?.[0] && (
                        <Space size={4}>
                            <CarOutlined style={{ color: "#8c8c8c" }} />
                            <DeliveryStatusTag status={record.deliveries[0].status} />
                        </Space>
                    )}
                </Space>
            ),
        },
        {
            title: t("Payment"),
            dataIndex: "payment_status",
            key: "payment_status",
            sorter: (a, b) => a.payment_status.localeCompare(b.payment_status),
            render: (paymentStatus: string, record: OrderRow) => (
                <Tooltip title={t("Received {paid} of {total}", { paid: formatPrice(Number(record.paid_amount ?? 0)), total: formatPrice(Number(record.total)) })}>
                    <Tag color={PAYMENT_STATUS_COLORS[paymentStatus] || "default"}>{t(PAYMENT_STATUS_LABELS[paymentStatus] ?? paymentStatus)}</Tag>
                </Tooltip>
            ),
        },
        {
            title: t("Date"),
            dataIndex: "created_at",
            key: "created_at",
            sorter: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
            render: (date: string) => formatDate(date),
        },
        {
            title: t("Action"),
            key: "action",
            width: 220,
            render: (_: any, record: OrderRow) => (
                <Space wrap>
                    {record.status === "pending" && (
                        <Tooltip title={t("The customer agreed (by phone or message)")}>
                            <Button size="small" icon={<CheckOutlined />} onClick={() => runAction({ action: "confirm", ids: [record.id] }, "Confirmed {count} order(s)")}>
                                {t("Confirm")}
                            </Button>
                        </Tooltip>
                    )}
                    {(record.status === "pending" || record.status === "confirmed") && (
                        <Popconfirm
                            title={t("Validate order {order_number}?", { order_number: record.order_number })}
                            description={t("This creates its Colissimo parcel, confirms the order and takes its items out of stock.")}
                            okText={t("Validate")}
                            onConfirm={() => handleValidate(record)}
                        >
                            <Button type="primary" size="small" loading={validatingId === record.id} onClick={(e) => e.stopPropagation()}>
                                {t("Validate")}
                            </Button>
                        </Popconfirm>
                    )}
                    <Button
                        type="link"
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => router.push(`/admin/orders/${record.id}`)}
                    >
                        {t("View")}
                    </Button>
                    {canDelete && (
                        <Popconfirm
                            title={t("Delete order")}
                            description={t("Are you sure you want to delete order {order_number}?", { order_number: record.order_number })}
                            okText={t("Yes, delete")}
                            cancelText={t("Cancel")}
                            onConfirm={() => handleDelete(record)}
                        >
                            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                                {t("Delete")}
                            </Button>
                        </Popconfirm>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div>
                <Breadcrumb
                    items={[
                        { title: <Link href="/admin/dashboard">{t("Dashboard")}</Link> },
                        { title: t("Orders") },
                        { title: t("List") },
                    ]}
                />
                <div
                    style={{
                        marginTop: 16,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 24,
                        flexWrap: "wrap",
                    }}
                >
                    <div>
                        <Title level={2} style={{ margin: 0, fontWeight: 600 }}>
                            {t("Orders")}
                        </Title>
                        <Text type="secondary">
                            {t("Manage customer orders and fulfillment")}
                        </Text>
                    </div>
                    <Space wrap>
                        {selectedRowKeys.length > 0 && (
                            <>
                                <Button icon={<CheckOutlined />} onClick={() => runAction({ action: "confirm", ids: selectedRowKeys }, "Confirmed {count} order(s)")}>
                                    {t("Confirm ({count})", { count: selectedRowKeys.length })}
                                </Button>
                                {toValidate.length > 0 && (
                                    <Popconfirm
                                        title={t("Validate {count} order(s)?", { count: toValidate.length })}
                                        description={t("This creates their Colissimo parcels and takes their items out of stock, then opens their slips to print.")}
                                        okText={t("Validate")}
                                        cancelText={t("Cancel")}
                                        onConfirm={handleBulkValidate}
                                    >
                                        <Button type="primary" loading={bulkValidating}>{t("Validate ({count})", { count: toValidate.length })}</Button>
                                    </Popconfirm>
                                )}
                                <Button icon={<PrinterOutlined />} onClick={() => router.push(`/admin/delivery/print?orders=${selectedRowKeys.join(",")}`)}>
                                    {t("Print slips ({count})", { count: selectedRowKeys.length })}
                                </Button>
                                {isAdmin ? (
                                    <Space.Compact>
                                        <AgentSelect value={assignTo} onChange={setAssignTo} style={{ minWidth: 180 }} />
                                        <Button onClick={() => runAction({ action: "assign", ids: selectedRowKeys, user_id: assignTo }, "Assigned {count} order(s)")}>
                                            {t("Assign")}
                                        </Button>
                                    </Space.Compact>
                                ) : (
                                    <Button icon={<UserAddOutlined />} onClick={() => runAction({ action: "assign", ids: selectedRowKeys, user_id: myId }, "Assigned {count} order(s)")}>
                                        {t("Take them")}
                                    </Button>
                                )}
                            </>
                        )}
                        {selectedRowKeys.length > 0 && canDelete && (
                                <Popconfirm
                                    title={t("Delete selected orders")}
                                    description={t("Are you sure you want to delete {count} order(s)?", { count: selectedRowKeys.length })}
                                    okText={t("Yes, delete")}
                                    cancelText={t("Cancel")}
                                    onConfirm={handleBulkDelete}
                                >
                                    <Button
                                        danger
                                        icon={<DeleteOutlined />}
                                        loading={bulkDeleting}
                                    >
                                        {t("Delete ({count})", { count: selectedRowKeys.length })}
                                    </Button>
                                </Popconfirm>
                        )}
                        <Button icon={<ReloadOutlined />} onClick={fetchOrders}>
                            {t("Refresh")}
                        </Button>
                        <Link href="/admin/orders/new">
                            <Button type="primary" icon={<PlusOutlined />}>{t("New order")}</Button>
                        </Link>
                    </Space>
                </div>
            </div>

            <Card>
                <div className="admin-filters" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
                    <Select
                        value={statusFilter}
                        onChange={(value) => setStatusFilter(value)}
                        options={[
                            { value: "all", label: t("All statuses") },
                            ...ORDER_STATUS_OPTIONS.map((o) => ({ ...o, label: t(o.label) })),
                        ]}
                        style={{ width: 160 }}
                    />
                    <Select
                        value={paymentStatusFilter}
                        onChange={(value) => setPaymentStatusFilter(value)}
                        options={[
                            { value: "all", label: t("All payments") },
                            ...Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => ({ value, label: t(label) })),
                        ]}
                        style={{ width: 160 }}
                    />
                    <Select
                        value={channelFilter}
                        onChange={setChannelFilter}
                        options={[{ value: "all", label: t("All channels") }, ...CHANNELS.map((c) => ({ value: c, label: t(CHANNEL_LABELS[c]) }))]}
                        style={{ width: 160 }}
                    />
                    <Select
                        value={addedByFilter}
                        onChange={(value) => setAddedByFilter(value)}
                        options={[
                            { value: "all", label: t("Handled by: anyone") },
                            { value: "me", label: t("Handled by me") },
                            { value: "none", label: t("Nobody yet") },
                            { value: "website", label: t("Website (customers)") },
                            ...agentOptions,
                        ]}
                        style={{ width: 220, maxWidth: "100%" }}
                    />
                    <DatePicker.RangePicker
                        value={range}
                        onChange={setRange}
                        allowEmpty={[true, true]}
                        placeholder={[t("Created from"), t("to")]}
                        style={{ width: 260, maxWidth: "100%" }}
                    />
                    <Input
                        placeholder={t("Search orders...")}
                        prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        style={{ flex: "1 1 240px", minWidth: 200 }}
                    />
                </div>

                <Table
                    rowKey="id"
                    loading={loading}
                    dataSource={filteredOrders}
                    columns={columns}
                    rowSelection={{
                        selectedRowKeys,
                        onChange: (selectedKeys) => setSelectedRowKeys(selectedKeys as string[]),
                        selections: [
                            Table.SELECTION_ALL,
                            Table.SELECTION_INVERT,
                            Table.SELECTION_NONE,
                        ],
                    }}
                    pagination={{
                        pageSize: 10,
                        showSizeChanger: true,
                        showTotal: (total) => t("{count} orders", { count: total }),
                    }}
                    locale={{
                        emptyText: (
                            <div style={{ padding: "40px 0", textAlign: "center" }}>
                                <div style={{ fontSize: 48, color: "#d9d9d9", marginBottom: 16 }}>📦</div>
                                <div style={{ color: "#999" }}>{t("No orders found")}</div>
                            </div>
                        ),
                    }}
                />
            </Card>
        </div>
    );
}

