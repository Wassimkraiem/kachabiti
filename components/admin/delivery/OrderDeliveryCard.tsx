"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Descriptions, Input, Popconfirm, Space, Typography } from "antd";
import { CarOutlined, DeleteOutlined, EditOutlined, PrinterOutlined, ReloadOutlined, LinkOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminRole } from "@/lib/admin-role-context";
import { DATE_LOCALES, useAdminT } from "@/lib/admin-i18n";
import DeliveryStatusTag, { ParcelBadges } from "./DeliveryStatusTag";
import EditParcelModal from "./EditParcelModal";
import SendParcelModal, { type ParcelOrder } from "./SendParcelModal";
import {
    canEditParcel,
    canRemoveParcel,
    deliveryApi,
    type Delivery,
    type DeliveryList,
    type RefreshResult,
    type RemoveResult,
} from "./delivery-api";

const { Text } = Typography;

/**
 * The order's Colissimo parcel: send the order, or see its barcode, status and delivery slip.
 * `onOrderChanged` reloads the order after sending or tracking changed its status.
 */
export default function OrderDeliveryCard({ order, orderStatus, onOrderChanged, reloadSignal = 0, openSendSignal = 0 }: {
    order: ParcelOrder;
    orderStatus: string;
    onOrderChanged: () => void;
    /** Changes when the page validated the order (and so created its parcel). */
    reloadSignal?: number;
    /** Changes when the page wants the send form open (validation needs details completed). */
    openSendSignal?: number;
}) {
    const { t, locale } = useAdminT();
    const canDelete = useAdminRole().can("delete");
    const [list, setList] = useState<DeliveryList | null>(null);
    const [sendOpen, setSendOpen] = useState(false);
    const [linkOpen, setLinkOpen] = useState(false);
    const [barcode, setBarcode] = useState("");
    const [busy, setBusy] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);

    const load = useCallback(async () => {
        try {
            setList(await deliveryApi<DeliveryList>({ query: `order_id=${order.id}` }));
        } catch (e) {
            message.error((e as Error).message);
        }
    }, [order.id]);

    useEffect(() => {
        load();
    }, [load, reloadSignal]);

    useEffect(() => {
        if (openSendSignal > 0) setSendOpen(true);
    }, [openSendSignal]);

    const delivery: Delivery | undefined = list?.rows[0];

    const refresh = async () => {
        if (!delivery) return;
        setBusy("refresh");
        try {
            const result = await deliveryApi<RefreshResult>({ method: "POST", body: { action: "refresh", ids: [delivery.id] } });
            if (result.failures.length) message.error(result.failures[0].error);
            else message.success(result.changed ? t("Status updated") : t("No change since the last check"));
            await load();
            if (result.changed) onOrderChanged();
        } catch (e) {
            message.error((e as Error).message);
        } finally {
            setBusy(null);
        }
    };

    const link = async () => {
        setBusy("link");
        try {
            await deliveryApi({ method: "POST", body: { action: "import", barcode: barcode.trim(), order_id: order.id } });
            message.success(t("Parcel linked to this order"));
            setLinkOpen(false);
            setBarcode("");
            await load();
        } catch (e) {
            message.error((e as Error).message);
        } finally {
            setBusy(null);
        }
    };

    const remove = async () => {
        if (!delivery) return;
        setBusy("remove");
        try {
            const result = await deliveryApi<RemoveResult>({ method: "DELETE", query: `ids=${delivery.id}` });
            if (result.kept.length) message.warning(t(result.kept[0].reason), 8);
            else message.success(t("Parcel removed"));
            await load();
        } catch (e) {
            message.error((e as Error).message);
        } finally {
            setBusy(null);
        }
    };

    const formatDate = (date: string | null) => (date ? new Date(date).toLocaleString(DATE_LOCALES[locale], { dateStyle: "medium", timeStyle: "short" }) : "—");

    return (
        <Card title={<Space><CarOutlined />{t("Delivery (Colissimo)")}</Space>} loading={!list}>
            {list && !list.configured.add && !delivery && (
                <Alert type="info" showIcon style={{ marginBottom: 16 }} title={t("Colissimo isn't connected yet")}
                    description={t("Add COLISSIMO_ADD_TOKEN and COLISSIMO_TRACKING_TOKEN (from your Colissimo account, Paramètres → APIs) to the server environment.")} />
            )}

            {delivery ? (
                <Space orientation="vertical" style={{ width: "100%" }} size="middle">
                    <Descriptions column={{ xs: 1, sm: 1, md: 2 }} size="small">
                        <Descriptions.Item label={t("Barcode")}>
                            {delivery.barcode ? <Text copyable strong>{delivery.barcode}</Text> : "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label={t("Status")}>
                            <Space size={6} wrap>
                                <DeliveryStatusTag status={delivery.status} reason={delivery.status_reason} />
                                {delivery.status_reason && <Text type="secondary">{delivery.status_reason}</Text>}
                                <ParcelBadges delivery={delivery} />
                            </Space>
                        </Descriptions.Item>
                        <Descriptions.Item label={t("Last status change")}>{formatDate(delivery.status_changed_at)}</Descriptions.Item>
                        <Descriptions.Item label={t("Cash to collect")}>{delivery.cod_amount != null ? `${Number(delivery.cod_amount)} TND` : "—"}</Descriptions.Item>
                        {delivery.handed_over_at && (
                            <Descriptions.Item label={t("Handed over for pickup")}>
                                {formatDate(delivery.handed_over_at)}
                                {delivery.manifest_id ? ` · ${t("manifest {number}", { number: delivery.manifest_id })}` : ""}
                            </Descriptions.Item>
                        )}
                    </Descriptions>
                    <Space wrap>
                        {delivery.label_url && (
                            <Button icon={<PrinterOutlined />} href={delivery.label_url} target="_blank" rel="noopener noreferrer">{t("Print delivery slip")}</Button>
                        )}
                        {delivery.label_zebra_url && (
                            <Button icon={<PrinterOutlined />} href={delivery.label_zebra_url} target="_blank" rel="noopener noreferrer">{t("Zebra label")}</Button>
                        )}
                        {delivery.barcode && (
                            <Button icon={<ReloadOutlined />} loading={busy === "refresh"} onClick={refresh}>{t("Check status")}</Button>
                        )}
                        {canEditParcel(delivery) && (
                            <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>{t("Edit parcel")}</Button>
                        )}
                        <Link href="/admin/delivery">{t("All parcels")}</Link>
                        {canDelete && canRemoveParcel(delivery) && (
                            <Popconfirm
                                styles={{ root: { maxWidth: 360 } }}
                                title={t("Remove this parcel?")}
                                description={t("A parcel waiting for pickup is deleted at Colissimo too. One Colissimo already has can't be removed. The order can then be sent again.")}
                                okText={t("Remove")}
                                cancelText={t("Cancel")}
                                onConfirm={remove}
                            >
                                <Button danger type="text" icon={<DeleteOutlined />} loading={busy === "remove"}>{t("Remove")}</Button>
                            </Popconfirm>
                        )}
                    </Space>
                </Space>
            ) : (
                list && (
                    <Space orientation="vertical" style={{ width: "100%" }}>
                        <Text type="secondary">{t("This order hasn't been sent to Colissimo yet.")}</Text>
                        <Space wrap>
                            <Button
                                type="primary"
                                icon={<CarOutlined />}
                                disabled={!list.configured.add || orderStatus === "cancelled" || orderStatus === "delivered" || orderStatus === "returned"}
                                onClick={() => setSendOpen(true)}
                                style={{ background: "#7a3b2e", borderColor: "#7a3b2e" }}
                            >
                                {t("Send to Colissimo")}
                            </Button>
                            <Button icon={<LinkOutlined />} disabled={!list.configured.tracking} onClick={() => setLinkOpen((v) => !v)}>
                                {t("Link an existing parcel")}
                            </Button>
                        </Space>
                        {linkOpen && (
                            <Space.Compact style={{ maxWidth: 420, width: "100%" }}>
                                <Input placeholder={t("Colissimo barcode")} inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/\D/g, ""))} onPressEnter={link} />
                                <Button type="primary" loading={busy === "link"} disabled={barcode.length < 6} onClick={link}>{t("Link")}</Button>
                            </Space.Compact>
                        )}
                    </Space>
                )
            )}

            <EditParcelModal
                delivery={editing ? delivery ?? null : null}
                onClose={() => setEditing(false)}
                onSaved={() => {
                    setEditing(false);
                    load();
                    onOrderChanged(); // the order's address or phone may have changed
                }}
            />

            <SendParcelModal
                order={order}
                open={sendOpen}
                onClose={() => setSendOpen(false)}
                onSent={(_delivery, warning) => {
                    setSendOpen(false);
                    if (warning) message.warning(t("The parcel was created, but the order status couldn't change: {error}", { error: warning }));
                    load();
                    onOrderChanged();
                }}
            />
        </Card>
    );
}
