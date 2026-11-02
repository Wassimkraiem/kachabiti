"use client";

import { Alert, Descriptions, Drawer, Space, Spin, Tag, Timeline, Typography } from "antd";
import { useAdminT } from "@/lib/admin-i18n";
import { useApi } from "@/components/admin/erp/erp-client";

const { Text, Title } = Typography;

interface PortalDetail {
    barcode: string;
    fields: { label: string; value: string }[];
    changes: { date: string; motif: string }[];
    history: { status: string; note: string | null; date: string; driver: string | null }[];
}

/** Colissimo's own status names (French, as on its website): a color from the words. */
export const portalStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes("payé") && s.includes("livr")) return "green";
    if (s.includes("livr")) return "cyan";
    if (s.includes("rtn") || s.includes("retour")) return "red";
    if (s.includes("anomalie") || s.includes("inconnu") || s.includes("vérifier")) return "gold";
    if (s.includes("cours") || s.includes("dépôt") || s.includes("enlevé")) return "blue";
    return "default";
};

/** A parcel's details and full status history, read from Colissimo's website (null: closed). */
export default function ParcelHistoryDrawer({ barcode, onClose }: { barcode: string | null; onClose: () => void }) {
    const { t } = useAdminT();
    const { data, loading, error } = useApi<PortalDetail>(barcode ? `/api/delivery/history?code=${barcode}` : null);

    return (
        <Drawer open={!!barcode} onClose={onClose} size="large" title={barcode ? t("Parcel {barcode}", { barcode }) : ""}>
            {loading ? (
                <Spin />
            ) : error ? (
                <Alert type="error" showIcon title={t(error)} />
            ) : (
                data && (
                    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
                        <Descriptions
                            bordered
                            size="small"
                            column={1}
                            items={data.fields.map((field) => ({ key: field.label, label: field.label, children: field.value || "—" }))}
                        />
                        <div>
                            <Title level={5}>{t("Status history")}</Title>
                            <Timeline
                                items={data.history.map((step) => ({
                                    color: portalStatusColor(step.status),
                                    content: (
                                        <div>
                                            <Tag color={portalStatusColor(step.status)}>{step.status}</Tag>
                                            {step.note && step.note !== step.status && <Text type="secondary">{step.note}</Text>}
                                            <div>
                                                <Text type="secondary" style={{ fontSize: 12 }}>
                                                    {step.date}
                                                    {step.driver ? ` · ${step.driver}` : ""}
                                                </Text>
                                            </div>
                                        </div>
                                    ),
                                }))}
                            />
                        </div>
                        {data.changes.length > 0 && (
                            <div>
                                <Title level={5}>{t("Changes")}</Title>
                                {data.changes.map((change, i) => (
                                    <div key={i}>
                                        <Text type="secondary">{change.date}</Text> · {change.motif}
                                    </div>
                                ))}
                            </div>
                        )}
                    </Space>
                )
            )}
        </Drawer>
    );
}
