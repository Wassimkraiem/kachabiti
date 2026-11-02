"use client";

import { useEffect, useState } from "react";
import { Checkbox, Col, Form, Input, InputNumber, Modal, Row, Select, Typography } from "antd";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { governorateOptions } from "@/lib/colissimo-data";
import ParcelProducts, { type ProductLine, type QuotedLine } from "@/components/admin/delivery/ParcelProducts";
import { api } from "@/components/admin/erp/erp-client";

const { Text } = Typography;

export interface EditableOrder {
    id: string;
    customer_first_name: string;
    customer_last_name: string;
    customer_email: string | null;
    customer_phone: string;
    shipping_address?: string;
    shipping_city?: string;
    shipping_state?: string;
    order_notes?: string;
    shipping_cost: number;
    discount_amount: number;
    items: { product_id?: string | null; variant_id?: string | null; quantity: number }[];
}

/**
 * Edits an order still to confirm or confirmed (PATCH /api/sales/orders, action `edit`): customer,
 * address, delivery fee, discount, notes and, when ticked, its products (re-priced from the catalog).
 */
export default function EditOrderModal({ order, open, onClose, onSaved }: { order: EditableOrder; open: boolean; onClose: () => void; onSaved: () => void }) {
    const { t, locale } = useAdminT();
    const [form] = Form.useForm();
    const [changeProducts, setChangeProducts] = useState(false);
    const [lines, setLines] = useState<ProductLine[]>([]);
    const [quoted, setQuoted] = useState<QuotedLine[] | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        form.setFieldsValue({
            phone: order.customer_phone,
            first_name: order.customer_first_name,
            last_name: order.customer_last_name,
            email: order.customer_email ?? undefined,
            governorate: order.shipping_state,
            city: order.shipping_city,
            address: order.shipping_address,
            shipping_cost: Number(order.shipping_cost),
            discount_amount: Number(order.discount_amount),
            notes: order.order_notes,
        });
        setChangeProducts(false);
        setLines(order.items.filter((i) => i.product_id).map((i, key) => ({ key, product_id: i.product_id!, variant_id: i.variant_id ?? undefined, quantity: i.quantity })));
    }, [open, order, form]);

    const save = async () => {
        const values = await form.validateFields();
        if (changeProducts && !quoted?.length) {
            message.warning(t("Add at least one product (with its size/colour)."));
            return;
        }
        setSaving(true);
        try {
            await api("/api/sales/orders", {
                method: "PATCH",
                body: {
                    action: "edit",
                    id: order.id,
                    customer: {
                        phone: values.phone.replace(/\D/g, ""),
                        first_name: values.first_name,
                        last_name: values.last_name ?? "",
                        email: values.email ?? "",
                        governorate: values.governorate,
                        city: values.city,
                        address: values.address,
                    },
                    items: changeProducts ? lines.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id, variant_id: l.variant_id ?? null, quantity: l.quantity })) : undefined,
                    shipping_cost: values.shipping_cost ?? undefined,
                    discount_amount: values.discount_amount ?? 0,
                    notes: values.notes ?? "",
                },
            });
            message.success(t("Order updated successfully!"));
            onSaved();
            onClose();
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open={open} title={t("Edit order")} onCancel={onClose} onOk={save} okText={t("Save")} cancelText={t("Cancel")} confirmLoading={saving} width={760} forceRender>
            <Form form={form} layout="vertical" requiredMark="optional">
                <Row gutter={12}>
                    <Col xs={24} md={12}>
                        <Form.Item name="phone" label={t("Phone")} rules={[{ required: true, pattern: /^\s*[24579](\s*\d){7}\s*$/, message: t("8 digits, starting with 2, 4, 5, 7 or 9") }]}>
                            <Input inputMode="tel" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}><Form.Item name="email" label={t("Email")} rules={[{ type: "email" }]}><Input /></Form.Item></Col>
                    <Col xs={24} md={12}><Form.Item name="first_name" label={t("First name")} rules={[{ required: true }]}><Input /></Form.Item></Col>
                    <Col xs={24} md={12}><Form.Item name="last_name" label={t("Last name")}><Input /></Form.Item></Col>
                    <Col xs={24} md={12}>
                        <Form.Item name="governorate" label={t("Governorate")} rules={[{ required: true }]}>
                            <Select showSearch optionFilterProp="label" options={governorateOptions(locale)} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}><Form.Item name="city" label={t("City")} rules={[{ required: true }]}><Input /></Form.Item></Col>
                    <Col xs={24}><Form.Item name="address" label={t("Address")} rules={[{ required: true }]}><Input /></Form.Item></Col>
                    <Col xs={12}>
                        <Form.Item name="shipping_cost" label={t("Delivery fee")}>
                            <InputNumber min={0} precision={3} style={{ width: "100%" }} suffix="TND" />
                        </Form.Item>
                    </Col>
                    <Col xs={12}>
                        <Form.Item name="discount_amount" label={t("Discount")}>
                            <InputNumber min={0} precision={3} style={{ width: "100%" }} suffix="TND" />
                        </Form.Item>
                    </Col>
                    <Col xs={24}><Form.Item name="notes" label={t("Notes")}><Input.TextArea rows={2} maxLength={2000} /></Form.Item></Col>
                </Row>
            </Form>
            <Checkbox checked={changeProducts} onChange={(e) => setChangeProducts(e.target.checked)}>{t("Change the products")}</Checkbox>
            {changeProducts ? (
                <div style={{ marginTop: 12 }}>
                    <ParcelProducts lines={lines} onChange={setLines} onQuote={setQuoted} />
                    <Text type="secondary" style={{ fontSize: 12 }}>{t("Products are re-priced from the catalog.")}</Text>
                </div>
            ) : (
                <Text type="secondary" style={{ display: "block", fontSize: 12 }}>{t("The products keep the price they were ordered at.")}</Text>
            )}
        </Modal>
    );
}
