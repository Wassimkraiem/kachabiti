"use client";

import { useEffect, useState } from "react";
import { Form, Input, Select, Switch, InputNumber, Row, Col, Typography } from "antd";
import { useAdminRole } from "@/lib/admin-role-context";
import { useAdminT } from "@/lib/admin-i18n";

const { Text } = Typography;

interface Named {
    id: string;
    name: string;
}

/**
 * Stock fields on the product forms: code, supplier, collection, website tracking and
 * purchase cost (needs the `costs` permission). The cost isn't a product column: save it with saveProductCost().
 */
export default function ProductStockFields({ showTracking = true }: { showTracking?: boolean }) {
    const { t } = useAdminT();
    const canSeeCosts = useAdminRole().can("costs");
    const [suppliers, setSuppliers] = useState<Named[]>([]);
    const [collections, setCollections] = useState<Named[]>([]);

    useEffect(() => {
        const load = (url: string, set: (rows: Named[]) => void) =>
            fetch(url)
                .then((res) => res.json())
                .then((json) => json.success && set(json.data))
                .catch(() => undefined);
        load("/api/stock/suppliers", setSuppliers);
        load("/api/stock/collections", setCollections);
    }, []);

    return (
        <>
            <Row gutter={16}>
                <Col xs={24} md={8}>
                    <Form.Item label={t("Product code")} name="code" extra={t("Leave empty to generate one from the category.")}>
                        <Input placeholder={t("e.g. KAC-0012")} maxLength={40} />
                    </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                    <Form.Item label={t("Supplier")} name="supplier_id">
                        <Select allowClear showSearch optionFilterProp="label" placeholder={t("None")} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
                    </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                    <Form.Item label={t("Collection")} name="collection_id">
                        <Select allowClear showSearch optionFilterProp="label" placeholder={t("None")} options={collections.map((c) => ({ value: c.id, label: c.name }))} />
                    </Form.Item>
                </Col>
            </Row>
            <Row gutter={16}>
                {showTracking && (
                    <Col xs={24} md={12}>
                        <Form.Item
                            label={t("Track stock on the website")}
                            name="stock_tracked"
                            valuePropName="checked"
                            extra={t("On: the shop shows the online location's stock and stops selling at zero. Off: always orderable.")}
                        >
                            <Switch />
                        </Form.Item>
                    </Col>
                )}
                {showTracking && (
                    <Col xs={24} md={12}>
                        <Form.Item
                            label={t("Made to order")}
                            name="made_to_order"
                            valuePropName="checked"
                            extra={t("On: orderable without stock (sur commande). Off: shown out of stock at zero.")}
                        >
                            <Switch />
                        </Form.Item>
                    </Col>
                )}
                {canSeeCosts && (
                    <Col xs={24} md={12}>
                        <Form.Item label={t("Purchase cost (per unit)")} name="cost" extra={<Text type="secondary">{t("Only people with the Costs permission see this.")}</Text>}>
                            <InputNumber min={0} precision={2} style={{ width: "100%" }} suffix="DT" placeholder={t("Not set")} />
                        </Form.Item>
                    </Col>
                )}
            </Row>
        </>
    );
}

export async function loadProductCost(productId: string): Promise<number | null> {
    const res = await fetch("/api/stock/costs");
    if (!res.ok) return null; // staff get 403
    const json = await res.json();
    const row = (json.data ?? []).find((c: { product_id: string }) => c.product_id === productId);
    return row ? Number(row.cost) : null;
}

export async function saveProductCost(productId: string, cost: number | null | undefined) {
    const res = await fetch("/api/stock/costs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, cost: cost ?? null }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Could not save the cost");
}
