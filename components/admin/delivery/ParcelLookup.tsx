"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Descriptions, Input, Space, Typography } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import DeliveryStatusTag from "./DeliveryStatusTag";
import { deliveryApi, type TrackResult } from "./delivery-api";

const { Text } = Typography;

/**
 * "Check a parcel": asks Colissimo's tracking API for any barcode and shows its status, reason
 * and previous status. Nothing is saved; a parcel that isn't in the list can be added from here.
 */
export default function ParcelLookup({ disabled, onAdded }: { disabled: boolean; onAdded: () => void }) {
    const { t } = useAdminT();
    const [barcode, setBarcode] = useState("");
    const [checking, setChecking] = useState(false);
    const [adding, setAdding] = useState(false);
    const [result, setResult] = useState<TrackResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const check = async () => {
        if (barcode.length < 6) return;
        setChecking(true);
        setError(null);
        setResult(null);
        try {
            setResult(await deliveryApi<TrackResult>({ method: "POST", body: { action: "track", barcode } }));
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setChecking(false);
        }
    };

    const add = async () => {
        if (!result) return;
        setAdding(true);
        try {
            await deliveryApi({ method: "POST", body: { action: "import", barcode: result.barcode } });
            message.success(t("Parcel {barcode} added", { barcode: result.barcode }));
            setResult(await deliveryApi<TrackResult>({ method: "POST", body: { action: "track", barcode: result.barcode } }));
            onAdded();
        } catch (e) {
            message.error((e as Error).message);
        } finally {
            setAdding(false);
        }
    };

    return (
        <Card title={<Space><SearchOutlined />{t("Check a parcel")}</Space>} style={{ marginBottom: 16 }}>
            <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                <Space.Compact style={{ maxWidth: 460, width: "100%" }}>
                    <Input
                        placeholder={t("Colissimo barcode")}
                        inputMode="numeric"
                        value={barcode}
                        disabled={disabled}
                        allowClear
                        onChange={(e) => {
                            setBarcode(e.target.value.replace(/\D/g, ""));
                            setResult(null);
                            setError(null);
                        }}
                        onPressEnter={check}
                    />
                    <Button type="primary" icon={<SearchOutlined />} loading={checking} disabled={disabled || barcode.length < 6} onClick={check}>
                        {t("Check status")}
                    </Button>
                </Space.Compact>

                {error && <Alert type="error" showIcon title={error} />}

                {result && (
                    <>
                        <Descriptions column={{ xs: 1, sm: 1, md: 2 }} size="small" bordered>
                            <Descriptions.Item label={t("Barcode")}>
                                <Text copyable strong style={{ fontFamily: "monospace" }}>{result.barcode}</Text>
                            </Descriptions.Item>
                            <Descriptions.Item label={t("Status")}>
                                <Space size={6} wrap>
                                    <DeliveryStatusTag status={result.status} />
                                    <Text type="secondary">{result.status}</Text>
                                </Space>
                            </Descriptions.Item>
                            <Descriptions.Item label={t("Reason")}>{result.reason || "—"}</Descriptions.Item>
                            <Descriptions.Item label={t("Driver's report")}>
                                {result.driverStatus ? (
                                    <Space size={6} wrap>
                                        <DeliveryStatusTag status={result.driverStatus} />
                                        {result.driverReason && <Text type="secondary">{result.driverReason}</Text>}
                                    </Space>
                                ) : "—"}
                            </Descriptions.Item>
                            <Descriptions.Item label={t("Paid by Colissimo")}>{result.paid ? t("Yes") : t("No")}</Descriptions.Item>
                            <Descriptions.Item label={t("In our list")} span={2}>
                                {result.delivery ? (
                                    result.delivery.order ? (
                                        <Link href={`/admin/orders/${result.delivery.order.id}`}>
                                            {t("Yes, order {order_number}", { order_number: result.delivery.order.order_number })}
                                        </Link>
                                    ) : (
                                        <Text>{t("Yes, not linked to an order")}</Text>
                                    )
                                ) : (
                                    <Space size={8} wrap>
                                        <Text type="secondary">{t("No")}</Text>
                                        <Button size="small" icon={<PlusOutlined />} loading={adding} onClick={add}>{t("Add to the list")}</Button>
                                    </Space>
                                )}
                            </Descriptions.Item>
                        </Descriptions>
                        {result.delivery && result.delivery.status !== result.status && (
                            <Text type="secondary">{t("The list still shows an older status: click “Refresh statuses” to update it.")}</Text>
                        )}
                    </>
                )}
            </Space>
        </Card>
    );
}
