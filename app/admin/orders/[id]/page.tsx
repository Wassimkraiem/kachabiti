"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    Button,
    Card,
    Breadcrumb,
    Typography,
    Space,
    Tag,
    Alert,
    Spin,
    Descriptions,
    Table,
    Select,
    Divider,
    Image,
} from "antd";
import { message } from "@/components/admin/antd-app";
import { ORDER_ITEM_IMAGE_FALLBACK, ORDER_STATUS_OPTIONS, errorCode, validateOrder } from "@/components/admin/order-status";
import type { ColumnsType } from "antd/es/table";
import {
    ArrowLeftOutlined,
    SaveOutlined,
} from "@ant-design/icons";
import { DATE_LOCALES, useAdminT } from "@/lib/admin-i18n";
import OrderDeliveryCard from "@/components/admin/delivery/OrderDeliveryCard";
import { reportParcelCancellation } from "@/components/admin/delivery/delivery-api";
import OrderPipelineCard, { type PipelineOrder } from "@/components/admin/erp/OrderPipelineCard";
import OrderPaymentsCard from "@/components/admin/erp/OrderPaymentsCard";

const { Title, Text } = Typography;

interface OrderItem {
    id: string;
    product_name: string;
    variant_label?: string | null;
    quantity: number;
    price: number;
    subtotal: number;
    product_image?: string;
}

interface Order extends PipelineOrder {
    id: string;
    order_number: string;
    customer_first_name: string;
    customer_last_name: string;
    customer_email: string;
    customer_phone: string;
    shipping_address?: string;
    shipping_city?: string;
    shipping_state?: string;
    shipping_zip?: string;
    shipping_country?: string;
    subtotal: number;
    shipping_cost: number;
    total: number;
    order_notes?: string;
    status: string;
    payment_status: string;
    stock_deducted?: boolean;
    created_at: string;
    created_by?: string | null;
    created_by_email?: string | null;
    discount_amount: number;
    paid_amount: number;
    items: OrderItem[];
}

export default function OrderDetailPage() {
    const { t, locale } = useAdminT();
    const router = useRouter();
    const params = useParams();
    const id = params?.id as string;

    const [order, setOrder] = useState<Order | null>(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);
    const [status, setStatus] = useState<string>("");

    // `quiet` reloads in place (after the delivery card changed the order) without the page spinner.
    const fetchOrder = useCallback(async (quiet = false) => {
            if (!quiet) setLoading(true);
            try {
                const response = await fetch(`/api/orders?id=${id}`);
                const result = await response.json();

                if (result.success && result.data) {
                    setOrder(result.data);
                    setStatus(result.data.status);
                } else {
                    message.error(t("Order not found"));
                    router.push("/admin/orders");
                }
            } catch (error) {
                console.error("Error fetching order:", error);
                message.error(t("Failed to load order details"));
            } finally {
                setLoading(false);
            }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- t only changes the error text
    }, [id, router]);

    useEffect(() => {
        if (id) fetchOrder();
    }, [id, fetchOrder]);

    const [validating, setValidating] = useState(false);
    // Bumped to make the delivery card reload, or open its send form (?send=1 from the orders list).
    const [deliveryVersion, setDeliveryVersion] = useState(0);
    const searchParams = useSearchParams();
    const [sendRequest, setSendRequest] = useState(() => (searchParams.get("send") === "1" ? 1 : 0));
    const handleValidate = async () => {
        if (!order) return;
        setValidating(true);
        try {
            const result = await validateOrder(order.id);
            if (result.delivery?.barcode) {
                message.success(t("Order {order_number} validated, Colissimo parcel {barcode}", { order_number: order.order_number, barcode: result.delivery.barcode }));
            } else {
                message.success(t("Order {order_number} validated", { order_number: order.order_number }));
            }
            if (result.warning) message.warning(t(result.warning));
            setDeliveryVersion((v) => v + 1);
            fetchOrder(true);
        } catch (e) {
            if (errorCode(e) === "NEEDS_DETAILS") {
                message.info(t("Complete the delivery details to validate this order"));
                setSendRequest((n) => n + 1);
                return;
            }
            message.error(t((e as Error).message));
        } finally {
            setValidating(false);
        }
    };

    const handleUpdateStatus = async () => {
        if (!order) return;

        setUpdating(true);
        try {
            const response = await fetch("/api/orders", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    id: order.id,
                    status,
                }),
            });

            const result = await response.json();

            if (result.success) {
                message.success(t("Order updated successfully!"));
                reportParcelCancellation(result.data?.parcels, message, t);
                fetchOrder(true);
            } else {
                message.error(result.error || t("Failed to update order"));
            }
        } catch (error: any) {
            console.error("Error updating order:", error);
            message.error(error.message || t("Failed to update order"));
        } finally {
            setUpdating(false);
        }
    };

    const formatPrice = (price: number) => {
        return `${Number(price).toFixed(3)} DT`;
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString(DATE_LOCALES[locale], {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const itemColumns: ColumnsType<OrderItem> = [
        {
            title: t("Product"),
            dataIndex: "product_name",
            key: "product_name",
            render: (name: string, item: OrderItem) => (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Image
                        src={item.product_image || undefined}
                        alt={name}
                        width={56}
                        height={56}
                        fallback={ORDER_ITEM_IMAGE_FALLBACK}
                        style={{ objectFit: "cover", objectPosition: "top", borderRadius: 8, border: "1px solid #f0f0f0", flexShrink: 0 }}
                    />
                    <div style={{ minWidth: 0 }}>
                        {name}
                        {item.variant_label && <div><Text type="secondary" style={{ fontSize: 12 }}>{item.variant_label}</Text></div>}
                    </div>
                </div>
            ),
        },
        {
            title: t("Quantity"),
            dataIndex: "quantity",
            key: "quantity",
            width: 100,
        },
        {
            title: t("Price"),
            dataIndex: "price",
            key: "price",
            width: 120,
            render: (price: number) => formatPrice(price),
        },
        {
            title: t("Subtotal"),
            dataIndex: "subtotal",
            key: "subtotal",
            width: 120,
            render: (subtotal: number) => formatPrice(subtotal),
        },
    ];

    if (loading) {
        return (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
                <Spin size="large" description={t("Loading order details...")}>
                    <div style={{ padding: "50px" }} />
                </Spin>
            </div>
        );
    }

    if (!order) {
        return null;
    }

    return (
        <div style={{ padding: 24, background: "#fff", minHeight: "100vh" }}>
            <Breadcrumb
                items={[
                    { title: <Link href="/admin/dashboard">{t("Dashboard")}</Link> },
                    { title: <Link href="/admin/orders">{t("Orders")}</Link> },
                    { title: order.order_number },
                ]}
            />

            <div style={{ marginTop: 24, marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                    <Title level={2} style={{ margin: 0, fontWeight: 600 }}>
                        {t("Order {number}", { number: order.order_number })}
                    </Title>
                    <Text type="secondary">
                        {t("Placed on {date}", { date: formatDate(order.created_at) })}
                    </Text>
                </div>
                <Button
                    icon={<ArrowLeftOutlined />}
                    onClick={() => router.push("/admin/orders")}
                >
                    {t("Back to Orders")}
                </Button>
            </div>

            <Space orientation="vertical" size="large" style={{ width: "100%" }}>
                {/* Status Update Card */}
                {(order.status === "pending" || order.status === "confirmed") && (
                    <Alert
                        type="warning"
                        showIcon
                        title={order.status === "pending" ? t("This order is waiting for the customer's confirmation") : t("This order is waiting for validation")}
                        description={t("Validating creates the Colissimo parcel, confirms the order and takes its items out of the online location's stock. Check the customer's details first.")}
                        action={
                            <Button type="primary" loading={validating} onClick={handleValidate} style={{ background: "#7a3b2e", borderColor: "#7a3b2e" }}>
                                {t("Validate order")}
                            </Button>
                        }
                    />
                )}
                <OrderPipelineCard order={order} onChanged={() => fetchOrder(true)} />

                <OrderPaymentsCard order={order} onChanged={() => fetchOrder(true)} />

                <Card title={t("Change the status by hand")}>
                    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
                        <div>
                            <Text strong style={{ display: "block", marginBottom: 8 }}>{t("Order Status")}</Text>
                            <Select
                                value={status}
                                onChange={setStatus}
                                style={{ width: 200 }}
                                options={ORDER_STATUS_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
                            />
                        </div>
                        <Text type="secondary">{t("Payment status follows the payments recorded above.")}</Text>
                        <Text type="secondary">
                            {order.stock_deducted ? (
                                <><Tag color="green">{t("Stock deducted")}</Tag>{t("Cancelling, or moving it back to pending, returns the items to stock.")}</>
                            ) : (
                                <><Tag>{t("Stock not deducted")}</Tag>{t("Validating the order (or marking it shipped or delivered) takes the items out of the online location's stock (tracked products only).")}</>
                            )}
                        </Text>
                        <Button
                            type="primary"
                            icon={<SaveOutlined />}
                            onClick={handleUpdateStatus}
                            loading={updating}
                            disabled={status === order.status}
                            style={{ background: "#7a3b2e", borderColor: "#7a3b2e" }}
                        >
                            {t("Update Status")}
                        </Button>
                    </Space>
                </Card>

                <OrderDeliveryCard
                    order={order}
                    orderStatus={order.status}
                    onOrderChanged={() => fetchOrder(true)}
                    reloadSignal={deliveryVersion}
                    openSendSignal={sendRequest}
                />

                {/* Customer Information */}
                <Card title={t("Customer Information")}>
                    <Descriptions column={{ xs: 1, sm: 1, md: 2 }}>
                        <Descriptions.Item label={t("Name")}>
                            {order.customer_first_name} {order.customer_last_name}
                        </Descriptions.Item>
                        <Descriptions.Item label={t("Email")}>{order.customer_email}</Descriptions.Item>
                        <Descriptions.Item label={t("Phone")}>{order.customer_phone || "—"}</Descriptions.Item>
                        <Descriptions.Item label={t("Added by")}>
                            {order.created_by ? order.created_by_email ?? t("an agent") : order.channel === "website" ? t("Website (customers)") : "—"}
                        </Descriptions.Item>
                    </Descriptions>
                </Card>

                {/* Shipping Information */}
                {(order.shipping_address || order.shipping_city) && (
                    <Card title={t("Shipping Address")}>
                        <Descriptions column={1}>
                            <Descriptions.Item label={t("Address")}>{order.shipping_address || "—"}</Descriptions.Item>
                            <Descriptions.Item label={t("City")}>{order.shipping_city || "—"}</Descriptions.Item>
                            <Descriptions.Item label={t("State/Province")}>{order.shipping_state || "—"}</Descriptions.Item>
                            <Descriptions.Item label={t("ZIP/Postal Code")}>{order.shipping_zip || "—"}</Descriptions.Item>
                            <Descriptions.Item label={t("Country")}>{order.shipping_country || "—"}</Descriptions.Item>
                        </Descriptions>
                    </Card>
                )}

                {/* Order Items */}
                <Card title={t("Order Items")}>
                    <Table
                        rowKey="id"
                        dataSource={order.items}
                        columns={itemColumns}
                        pagination={false}
                    />
                    <Divider />
                    <div style={{ textAlign: "right" }}>
                        <Space orientation="vertical" size="small">
                            <div>
                                <Text>{t("Subtotal:")} </Text>
                                <Text strong>{formatPrice(order.subtotal)}</Text>
                            </div>
                            {Number(order.discount_amount) > 0 && (
                                <div>
                                    <Text>{t("Discount:")} </Text>
                                    <Text strong>− {formatPrice(order.discount_amount)}</Text>
                                </div>
                            )}
                            <div>
                                <Text>{t("Shipping:")} </Text>
                                <Text strong>{formatPrice(order.shipping_cost)}</Text>
                            </div>
                            <div style={{ fontSize: 18 }}>
                                <Text strong>{t("Total:")} </Text>
                                <Text strong style={{ color: "#7a3b2e" }}>{formatPrice(order.total)}</Text>
                            </div>
                        </Space>
                    </div>
                </Card>

                {/* Order Notes */}
                {order.order_notes && (
                    <Card title={t("Order Notes")}>
                        <Text>{order.order_notes}</Text>
                    </Card>
                )}
            </Space>
        </div>
    );
}

