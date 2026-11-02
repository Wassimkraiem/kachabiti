"use client";

import { Space, Tag, Tooltip } from "antd";
import { useAdminT } from "@/lib/admin-i18n";
import { statusInfo } from "@/lib/colissimo-data";
import type { Delivery } from "./delivery-api";

/**
 * What else Colissimo says about a parcel: the driver's live report (before Colissimo confirms it),
 * its payment, and a price change waiting for Colissimo's answer.
 */
export function ParcelBadges({ delivery }: { delivery: Delivery }) {
    const { t } = useAdminT();
    const driver = delivery.driver_status && delivery.driver_status !== delivery.status ? statusInfo(delivery.driver_status) : null;
    if (!driver && !delivery.paid && !delivery.price_change) return null;
    return (
        <Space size={4} wrap>
            {driver && (
                <Tooltip title={[t("What the driver reported, before Colissimo confirms it"), delivery.driver_reason].filter(Boolean).join(" — ")}>
                    <Tag bordered={false} color="processing">{t("Driver: {status}", { status: t(driver.label) })}</Tag>
                </Tooltip>
            )}
            {delivery.paid && <Tag bordered={false} color="success">{t("Paid by Colissimo")}</Tag>}
            {delivery.price_change && (
                <Tooltip title={delivery.price_change.reason || undefined}>
                    <Tag bordered={false} color="warning">
                        {t("Price change requested: {price} TND", { price: delivery.price_change.new_price })}
                    </Tag>
                </Tooltip>
            )}
        </Space>
    );
}

/** Colissimo status as a coloured tag; the original Colissimo wording and reason show on hover. */
export default function DeliveryStatusTag({ status, reason }: { status: string; reason?: string | null }) {
    const { t } = useAdminT();
    const info = statusInfo(status);
    const tip = [status !== "sending" ? `Colissimo: ${status}` : null, reason].filter(Boolean).join(" — ");
    return (
        <Tooltip title={tip || undefined}>
            <Tag color={info.color} style={{ marginInlineEnd: 0 }}>{t(info.label)}</Tag>
        </Tooltip>
    );
}
