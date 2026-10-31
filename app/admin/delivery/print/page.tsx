"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Button, Space, Spin, Typography } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { useAdminT } from "@/lib/admin-i18n";
import { deliveryApi, type Delivery, type DeliveryList } from "@/components/admin/delivery/delivery-api";

const { Text } = Typography;

/**
 * The Colissimo delivery slips of several orders (?orders=id1,id2), one per A4 sheet, printed in
 * one go. Opened after validating orders in bulk, or from "Print slips" on the orders list.
 */
export default function PrintSlipsPage() {
    const { t } = useAdminT();
    const search = useSearchParams();
    const [slips, setSlips] = useState<Delivery[] | null>(null);
    const [loaded, setLoaded] = useState(0);
    const orderIds = (search.get("orders") ?? "").split(",").filter(Boolean);

    useEffect(() => {
        Promise.all(orderIds.map((id) => deliveryApi<DeliveryList>({ query: `order_id=${encodeURIComponent(id)}` }).then((r) => r.rows[0]).catch(() => undefined)))
            .then((rows) => setSlips(rows.filter((d): d is Delivery => !!d?.label_url)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search]);

    // Print once every slip has loaded in its frame.
    useEffect(() => {
        if (slips?.length && loaded >= slips.length) setTimeout(() => window.print(), 500);
    }, [slips, loaded]);

    if (!slips) return <Spin />;
    return (
        <div>
            <style>{`
                .slip-frame { display: block; width: 100%; height: 1100px; border: 1px dashed #ccc; background: #fff; }
                @media print {
                    body * { visibility: hidden; }
                    .slips, .slips * { visibility: visible; }
                    .slips { position: absolute; inset: 0 auto auto 0; width: 100%; }
                    .slip-frame { height: 277mm; border: 0; break-after: page; }
                    .no-print { display: none !important; }
                    @page { size: A4; margin: 10mm; }
                }
            `}</style>
            <Space className="no-print" wrap style={{ marginBottom: 16 }}>
                <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()} disabled={slips.length === 0}>
                    {t("Print {count} slip(s)", { count: slips.length })}
                </Button>
                {orderIds.length > slips.length && (
                    <Text type="secondary">{t("{count} order(s) have no Colissimo slip yet", { count: orderIds.length - slips.length })}</Text>
                )}
            </Space>
            {slips.length === 0 && <Alert className="no-print" type="info" showIcon title={t("No delivery slip to print")} />}
            <div className="slips">
                {slips.map((d) => (
                    <div key={d.id}>
                        <div className="no-print" style={{ margin: "12px 0 4px" }}>
                            <Text strong style={{ fontFamily: "monospace" }}>{d.order?.order_number ?? d.barcode}</Text>{" "}
                            {/* If Colissimo refuses to show its slip in a frame, it can still be opened on its own. */}
                            <a href={d.label_url!} target="_blank" rel="noopener noreferrer">{t("Open slip")}</a>
                        </div>
                        <iframe className="slip-frame" src={d.label_url!} title={d.barcode ?? d.id} onLoad={() => setLoaded((n) => n + 1)} />
                    </div>
                ))}
            </div>
        </div>
    );
}
