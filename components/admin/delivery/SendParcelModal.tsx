"use client";

import { useEffect, useState } from "react";
import { Alert, Divider, Form, Input, InputNumber, Modal, Radio, Select, Switch, Typography } from "antd";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { COLISSIMO_GOVERNORATES, parcelFromOrder, type OrderForParcel } from "@/lib/colissimo-data";
import { deliveryApi, type Delivery } from "./delivery-api";
import ParcelProducts, { type ProductLine, type QuotedLine } from "./ParcelProducts";
import { useApi } from "@/components/admin/erp/erp-client";

const { Text } = Typography;

export interface ParcelOrder extends OrderForParcel {
    id: string;
    order_number: string;
}

interface FormValues {
    nom: string;
    tel: string;
    tel2?: string;
    gouvernerat?: string;
    ville: string;
    adresse: string;
    designation: string;
    nb_article: number;
    prix: number;
    msg?: string;
    ouvrir: boolean;
    fragile: boolean;
    type_colis: 1 | 2 | 3;
    echange: boolean;
    article?: string;
    nb_echange?: number;
}

function initialValues(order: ParcelOrder): FormValues {
    const parcel = parcelFromOrder(order);
    return {
        ...parcel,
        gouvernerat: parcel.gouvernerat ?? undefined,
        ouvrir: true,
        fragile: false,
        echange: false,
    };
}

// A parcel entered by hand starts empty apart from the usual options.
const BLANK: Partial<FormValues> = { nb_article: 1, ouvrir: true, fragile: false, type_colis: 1, echange: false };

/** Form to create a parcel at Colissimo: filled in from the order, or empty for a parcel entered by hand. */
export default function SendParcelModal({ order, open, onClose, onSent }: {
    order?: ParcelOrder;
    open: boolean;
    onClose: () => void;
    onSent: (delivery: Delivery, warning: string | null) => void;
}) {
    const { t } = useAdminT();
    const [form] = Form.useForm<FormValues>();
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const exchange = Form.useWatch("echange", form);
    // Parcel entered by hand: its products (an order is created so they leave the stock).
    const [lines, setLines] = useState<ProductLine[]>([]);
    const [quote, setQuote] = useState<QuotedLine[] | null>([]);
    const withProducts = !order && lines.length > 0;
    const fee = useApi<{ fee: number }>(open && !order ? "/api/sales/orders/delivery-fee" : null).data?.fee ?? 0;

    useEffect(() => {
        if (open) {
            form.resetFields();
            form.setFieldsValue(order ? initialValues(order) : BLANK);
            setError(null);
            setLines([]);
            setQuote([]);
        }
    }, [open, order, form]);

    // Contents, item count and cash (products + the usual delivery fee) follow the products; the cash stays editable.
    const onQuote = (quoted: QuotedLine[] | null) => {
        setQuote(quoted);
        if (!quoted || quoted.length === 0) return;
        form.setFieldsValue({
            designation: quoted
                .map((l) => `${l.quantity > 1 ? `${l.quantity}× ` : ""}${l.product_name.trim()}${l.variant_label ? ` (${l.variant_label})` : ""}`)
                .join(", ")
                .slice(0, 250),
            nb_article: quoted.reduce((sum, l) => sum + l.quantity, 0),
            prix: quoted.reduce((sum, l) => sum + l.subtotal, 0) + fee,
        });
    };

    const submit = async () => {
        // Products first: contents, item count and cash are filled from complete product lines.
        if (withProducts && !quote) {
            setError(t("Choose a product and a size/colour on every product line, or remove the line."));
            return;
        }
        let values: FormValues;
        try {
            values = await form.validateFields();
        } catch {
            return; // the form shows what's missing
        }
        setSending(true);
        setError(null);
        try {
            const result = await deliveryApi<{ delivery: Delivery; order?: { order_number: string } | null; warning: string | null }>({
                method: "POST",
                body: {
                    action: "create",
                    order_id: order?.id,
                    items: withProducts ? lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id ?? null, quantity: l.quantity })) : undefined,
                    parcel: {
                        nom: values.nom,
                        tel: values.tel,
                        tel2: values.tel2 || undefined,
                        gouvernerat: values.gouvernerat,
                        ville: values.ville,
                        adresse: values.adresse,
                        designation: values.designation,
                        nb_article: values.nb_article,
                        prix: values.prix,
                        msg: values.msg || undefined,
                        echange: values.echange ? "oui" : "non",
                        article: values.echange ? values.article : undefined,
                        nb_echange: values.echange ? values.nb_echange ?? 0 : 0,
                        ouvrir: values.ouvrir ? 1 : 0,
                        fragile: values.fragile ? 1 : 0,
                        type_colis: values.type_colis,
                    },
                },
            });
            if (withProducts && result.order) {
                message.success(t("Order {order_number} created and parcel {barcode} sent to Colissimo", { order_number: result.order.order_number, barcode: result.delivery.barcode ?? "" }));
            } else {
                message.success(t("Parcel {barcode} created at Colissimo", { barcode: result.delivery.barcode ?? "" }));
            }
            onSent(result.delivery, result.warning);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSending(false);
        }
    };

    const phoneRule = { pattern: /^\d{8}$/, message: t("Exactly 8 digits") };

    return (
        <Modal
            open={open}
            title={order ? t("Send order {order_number} to Colissimo", { order_number: order.order_number }) : t("New Colissimo parcel")}
            okText={t("Create parcel")}
            cancelText={t("Cancel")}
            onOk={submit}
            onCancel={onClose}
            confirmLoading={sending}
            width={640}
            destroyOnHidden
            okButtonProps={{ style: { background: "#7a3b2e", borderColor: "#7a3b2e" } }}
        >
            <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
                {order
                    ? t("Check the details: Colissimo prints them on the delivery slip. Creating the parcel validates the order.")
                    : t("Enter the parcel details: Colissimo prints them on the delivery slip.")}
            </Text>
            {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
            <Form form={form} layout="vertical" requiredMark>
                <Form.Item name="nom" label={t("Customer name")} rules={[{ required: true, message: t("Required") }]}>
                    <Input maxLength={100} />
                </Form.Item>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <Form.Item name="tel" label={t("Phone")} rules={[{ required: true, message: t("Required") }, phoneRule]} style={{ flex: "1 1 200px" }}>
                        <Input inputMode="numeric" maxLength={8} />
                    </Form.Item>
                    <Form.Item name="tel2" label={t("Second phone (optional)")} rules={[phoneRule]} style={{ flex: "1 1 200px" }}>
                        <Input inputMode="numeric" maxLength={8} />
                    </Form.Item>
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <Form.Item
                        name="gouvernerat"
                        label={t("Governorate")}
                        rules={[{ required: true, message: t("Choose the governorate") }]}
                        extra={order && !order.shipping_state && !order.shipping_city ? t("The customer didn't give one: check the address.") : undefined}
                        style={{ flex: "1 1 200px" }}
                    >
                        <Select showSearch options={COLISSIMO_GOVERNORATES.map((name) => ({ value: name, label: name }))} />
                    </Form.Item>
                    <Form.Item name="ville" label={t("City")} rules={[{ required: true, message: t("Required") }]} style={{ flex: "1 1 200px" }}>
                        <Input maxLength={100} />
                    </Form.Item>
                </div>
                <Form.Item name="adresse" label={t("Address")} rules={[{ required: true, message: t("Required") }]}>
                    <Input maxLength={250} />
                </Form.Item>
                {!order && (
                    <>
                        <Divider titlePlacement="start" style={{ marginTop: 4 }}>{t("Products")}</Divider>
                        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                            {t("Pick the products in the parcel: an order is created for them and they leave the stock. Leave empty for a parcel without products.")}
                        </Text>
                        <ParcelProducts lines={lines} onChange={setLines} onQuote={onQuote} />
                        <Divider style={{ margin: "16px 0" }} />
                    </>
                )}
                <Form.Item name="designation" label={t("Contents")} rules={[{ required: true, message: t("Required") }]}>
                    <Input.TextArea rows={2} maxLength={250} showCount disabled={withProducts} />
                </Form.Item>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <Form.Item name="nb_article" label={t("Number of items")} rules={[{ required: true, message: t("Required") }]} style={{ flex: "1 1 140px" }}>
                        <InputNumber min={1} max={999} precision={0} style={{ width: "100%" }} disabled={withProducts} />
                    </Form.Item>
                    <Form.Item
                        name="prix"
                        label={t("Cash to collect (TND)")}
                        rules={[{ required: true, message: t("Required") }]}
                        extra={withProducts ? t("The products' total plus the {fee} TND delivery fee. Change it if needed.", { fee }) : undefined}
                        style={{ flex: "1 1 140px" }}
                    >
                        <InputNumber min={0} max={100000} step={1} style={{ width: "100%" }} />
                    </Form.Item>
                </div>
                <Form.Item name="type_colis" label={t("Parcel size")}>
                    <Radio.Group
                        optionType="button"
                        options={[
                            { value: 1, label: t("Small") },
                            { value: 2, label: t("Medium") },
                            { value: 3, label: t("Large") },
                        ]}
                    />
                </Form.Item>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    <Form.Item name="ouvrir" label={t("Customer may open the parcel")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item name="fragile" label={t("Fragile")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item name="echange" label={t("Exchange")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </div>
                {exchange && (
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <Form.Item name="article" label={t("Items to take back")} rules={[{ required: true, message: t("Required") }]} style={{ flex: "2 1 240px" }}>
                            <Input maxLength={250} />
                        </Form.Item>
                        <Form.Item name="nb_echange" label={t("How many")} rules={[{ required: true, message: t("Required") }]} style={{ flex: "1 1 120px" }}>
                            <InputNumber min={1} max={999} precision={0} style={{ width: "100%" }} />
                        </Form.Item>
                    </div>
                )}
                <Form.Item name="msg" label={t("Note for the courier (optional)")}>
                    <Input maxLength={250} />
                </Form.Item>
            </Form>
        </Modal>
    );
}
