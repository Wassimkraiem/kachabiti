"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Button, Space, Spin, Typography } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { useAdminT } from "@/lib/admin-i18n";
import { deliveryApi, type DeliveryList } from "@/components/admin/delivery/delivery-api";

const { Text } = Typography;

interface Slip {
    barcode: string;
    label: string; // order number, or the barcode
}

/**
 * Colissimo's half-page delivery slips (from its website, GET /api/delivery/slip), two per A4
 * sheet, printed in one go. ?orders=id1,id2 (Orders list, after validating in bulk) or
 * ?codes=barcode1,barcode2 (Delivery tab).
 */
export default function PrintSlipsPage() {
    const { t } = useAdminT();
    const search = useSearchParams();
    const [slips, setSlips] = useState<Slip[] | null>(null);
    const [loaded, setLoaded] = useState(0);
    const orderIds = (search.get("orders") ?? "").split(",").filter(Boolean);
    const codes = (search.get("codes") ?? "").split(",").filter((c) => /^\d{6,20}$/.test(c));
    const asked = orderIds.length + codes.length;

    useEffect(() => {
        Promise.all(orderIds.map((id) => deliveryApi<DeliveryList>({ query: `order_id=${encodeURIComponent(id)}` }).then((r) => r.rows[0]).catch(() => undefined)))
            .then((rows) => setSlips([
                ...rows.flatMap((d) => (d?.barcode ? [{ barcode: d.barcode, label: d.order?.order_number ?? d.barcode }] : [])),
                ...codes.map((barcode) => ({ barcode, label: barcode })),
            ]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search]);

    // Print once every slip has loaded in its frame.
    useEffect(() => {
        if (slips?.length && loaded >= slips.length) setTimeout(() => window.print(), 800);
    }, [slips, loaded]);

    if (!slips) return <Spin />;
    return (
        <div>
            <style>{`
                .slip-frame { display: block; width: 100%; height: 560px; border: 1px dashed #ccc; background: #fff; }
                @media print {
                    body * { visibility: hidden; }
                    .slips, .slips * { visibility: visible; }
                    .slips { position: absolute; inset: 0 auto auto 0; width: 100%; }
                    .slip { height: 138mm; overflow: hidden; break-inside: avoid; }
                    .slip:nth-child(2n) { break-after: page; }
                    .slip-frame { height: 138mm; border: 0; }
                    .no-print { display: none !important; }
                    @page { size: A4; margin: 8mm; }
                }
            `}</style>
            <Space className="no-print" wrap style={{ marginBottom: 16 }}>
                <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()} disabled={slips.length === 0}>
                    {t("Print {count} slip(s)", { count: slips.length })}
                </Button>
                <Text type="secondary">{t("Two slips per A4 sheet")}</Text>
                {asked > slips.length && (
                    <Text type="secondary">{t("{count} order(s) have no Colissimo slip yet", { count: asked - slips.length })}</Text>
                )}
            </Space>
            {slips.length === 0 && <Alert className="no-print" type="info" showIcon title={t("No delivery slip to print")} />}
            <div className="slips">
                {slips.map((s) => (
                    <div className="slip" key={s.barcode}>
                        <div className="no-print" style={{ margin: "12px 0 4px" }}>
                            <Text strong style={{ fontFamily: "monospace" }}>{s.label}</Text>
                        </div>
                        {/* Colissimo's own page: sandboxed, so its scripts can't reach the admin, and
                            without allow-modals so it can't open a print dialog of its own. */}
                        <iframe
                            className="slip-frame"
                            src={`/api/delivery/slip?code=${s.barcode}`}
                            sandbox="allow-scripts"
                            title={s.barcode}
                            onLoad={() => setLoaded((n) => n + 1)}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
