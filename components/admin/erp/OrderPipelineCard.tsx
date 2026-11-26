"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Card, Col, Row, Select, Space, Steps, Typography } from "antd";
import { CheckOutlined, PhoneOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { useAdminRole } from "@/lib/admin-role-context";
import { CHANNELS, CHANNEL_LABELS } from "@/lib/erp/constants";
import { AgentSelect, CampaignSelect } from "./ui";
import { api, formatDate } from "./erp-client";

const { Text } = Typography;

export interface PipelineOrder {
    id: string;
    status: string;
    payment_status: string;
    channel: string;
    campaign_id: string | null;
    customer_id: string | null;
    assigned_to: string | null;
    assigned_to_email: string | null;
    created_by_email?: string | null;
    created_at: string;
    confirmed_at: string | null;
    confirmed_by_email: string | null;
    delivered_at: string | null;
    returned_at: string | null;
    cancelled_at: string | null;
}

/**
 * The order's journey, one step at a time: taken → confirmed by the customer → validated (parcel,
 * stock) → shipped → delivered → paid. Being delivered is not being paid: the last step follows the
 * payments received. Also where the order came from and who handles it.
 */
export default function OrderPipelineCard({ order, onChanged }: { order: PipelineOrder; onChanged: () => void }) {
    const { t, locale } = useAdminT();
    const { id: myId, isAdmin } = useAdminRole();
    const [saving, setSaving] = useState(false);

    const order_ = ["pending", "confirmed", "processing", "shipped", "delivered"];
    const reached = order_.indexOf(order.status);
    const failed = order.status === "returned" || order.status === "cancelled";
    const paid = order.payment_status === "paid";
    const current = failed ? Math.max(1, order.confirmed_at ? 3 : 1) : paid ? 5 : Math.max(0, reached);

    const patch = async (body: Record<string, unknown>, done: string) => {
        setSaving(true);
        try {
            await api("/api/sales/orders", { method: "PATCH", body });
            message.success(t(done));
            onChanged();
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card title={t("Order journey")}>
            <Steps
                size="small"
                current={current}
                status={failed ? "error" : paid ? "finish" : "process"}
                responsive
                items={[
                    { title: t("Taken"), description: formatDate(order.created_at, locale, true) },
                    { title: t("Confirmed"), description: order.confirmed_at ? `${formatDate(order.confirmed_at, locale, true)}${order.confirmed_by_email ? ` · ${order.confirmed_by_email}` : ""}` : undefined },
                    { title: t("Validated"), description: reached >= 2 ? t("Parcel created, stock out") : undefined },
                    { title: order.status === "returned" ? t("Returned") : order.status === "cancelled" ? t("Cancelled") : t("Shipped"), description: order.returned_at ? formatDate(order.returned_at, locale) : order.cancelled_at ? formatDate(order.cancelled_at, locale) : undefined },
                    { title: t("Delivered"), description: order.delivered_at ? formatDate(order.delivered_at, locale) : undefined },
                    { title: t("Paid"), description: paid ? t("Money received") : order.payment_status === "partial" ? t("Partly paid") : undefined },
                ]}
            />
            {(order.status === "pending" || order.status === "unreachable") && (
                <Space style={{ marginTop: 16 }} wrap>
                    <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={() => patch({ action: "confirm", ids: [order.id] }, "Order confirmed")}>
                        {t("Customer confirmed")}
                    </Button>
                    {order.status === "pending" && (
                        <Button icon={<PhoneOutlined />} loading={saving} onClick={() => patch({ action: "unreachable", ids: [order.id] }, "Marked unreachable")}>
                            {t("Customer unreachable")}
                        </Button>
                    )}
                    <Text type="secondary">{t("Call or message the customer first, then validate to send the parcel.")}</Text>
                </Space>
            )}

            <Row gutter={[16, 12]} style={{ marginTop: 20 }}>
                <Col xs={24} md={8}>
                    <Text type="secondary" style={{ display: "block", fontSize: 12 }}>{t("Came from")}</Text>
                    <Select
                        value={order.channel}
                        style={{ width: "100%" }}
                        disabled={saving}
                        onChange={(channel) => patch({ action: "source", id: order.id, channel, campaign_id: order.campaign_id }, "Saved")}
                        options={CHANNELS.map((c) => ({ value: c, label: t(CHANNEL_LABELS[c]) }))}
                    />
                </Col>
                <Col xs={24} md={8}>
                    <Text type="secondary" style={{ display: "block", fontSize: 12 }}>{t("Campaign")}</Text>
                    <CampaignSelect value={order.campaign_id} style={{ width: "100%" }} onChange={(campaign_id) => patch({ action: "source", id: order.id, channel: order.channel, campaign_id }, "Saved")} />
                </Col>
                <Col xs={24} md={8}>
                    <Text type="secondary" style={{ display: "block", fontSize: 12 }}>{t("Handled by")}</Text>
                    {isAdmin ? (
                        <AgentSelect value={order.assigned_to} style={{ width: "100%" }} onChange={(user_id) => patch({ action: "assign", ids: [order.id], user_id }, "Saved")} />
                    ) : (
                        <Space>
                            <span>{order.assigned_to_email ?? order.created_by_email ?? t("Nobody")}</span>
                            {!order.assigned_to && <Button size="small" onClick={() => patch({ action: "assign", ids: [order.id], user_id: myId }, "Saved")}>{t("Take it")}</Button>}
                        </Space>
                    )}
                </Col>
            </Row>
            {order.customer_id && (
                <div style={{ marginTop: 12 }}>
                    <Link href={`/admin/customers/${order.customer_id}`}>{t("Customer record and history")}</Link>
                </div>
            )}
        </Card>
    );
}
