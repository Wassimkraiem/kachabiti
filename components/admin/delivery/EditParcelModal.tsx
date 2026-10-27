"use client";

import { useEffect, useState } from "react";
import { Alert, Form, Input, InputNumber, Modal, Select, Typography } from "antd";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { COLISSIMO_GOVERNORATES } from "@/lib/colissimo-data";
import { canEditParcel, deliveryApi, type Delivery } from "./delivery-api";

const { Text } = Typography;

interface EditValues {
    nom: string;
    tel: string;
    tel2?: string;
    gouvernerat: string;
    ville: string;
    adresse: string;
    designation: string;
    nb_article: number;
    prix: number;
    reason?: string;
}

/**
 * Fixes a parcel at Colissimo. While it waits for pickup every field can change (and the order
 * keeps the corrected details); once handed over or printed only its price can, as a request
 * Colissimo answers later. Only the fields that changed are sent.
 */
export default function EditParcelModal({ delivery, onClose, onSaved }: {
    delivery: Delivery | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t } = useAdminT();
    const [form] = Form.useForm<EditValues>();
    const [saving, setSaving] = useState(false);
    const editable = delivery ? canEditParcel(delivery) : false;

    useEffect(() => {
        if (!delivery) return;
        form.setFieldsValue({
            nom: delivery.recipient_name ?? "",
            tel: delivery.phone ?? "",
            gouvernerat: delivery.governorate ?? undefined,
            ville: delivery.city ?? "",
            adresse: delivery.address ?? "",
            designation: delivery.designation ?? "",
            nb_article: delivery.items_count ?? 1,
            prix: Number(delivery.price_change?.new_price ?? delivery.cod_amount ?? 0),
            reason: undefined,
        });
    }, [delivery, form]);

    const save = async () => {
        if (!delivery) return;
        const values = await form.validateFields();
        setSaving(true);
        try {
            if (editable) {
                const before: Partial<EditValues> = {
                    nom: delivery.recipient_name ?? "", tel: delivery.phone ?? "", gouvernerat: delivery.governorate ?? undefined,
                    ville: delivery.city ?? "", adresse: delivery.address ?? "", designation: delivery.designation ?? "",
                    nb_article: delivery.items_count ?? 1, prix: Number(delivery.cod_amount ?? 0),
                };
                const parcel = Object.fromEntries(
                    (["nom", "tel", "tel2", "gouvernerat", "ville", "adresse", "designation", "nb_article", "prix"] as const)
                        .filter((key) => values[key] !== undefined && values[key] !== "" && values[key] !== before[key])
                        .map((key) => [key, values[key]]),
                );
                if (Object.keys(parcel).length === 0) {
                    message.info(t("Nothing to change"));
                    onClose();
                    return;
                }
                const result = await deliveryApi<{ changed: boolean; price_change: unknown }>({ method: "POST", body: { action: "edit", id: delivery.id, parcel } });
                if (result.price_change) message.success(t("The label was already printed: price change requested. Colissimo will answer."));
                else message.success(result.changed ? t("Parcel updated at Colissimo") : t("Colissimo already had these details"));
            } else {
                await deliveryApi({ method: "POST", body: { action: "price_change", id: delivery.id, price: values.prix, reason: values.reason || undefined } });
                message.success(t("Price change requested. Colissimo will answer."));
            }
            onSaved();
        } catch (e) {
            message.error((e as Error).message);
        } finally {
            setSaving(false);
        }
    };

    const phoneRule = { pattern: /^\d{8}$/, message: t("Exactly 8 digits") };
    const row = { display: "flex", gap: 12, flexWrap: "wrap" as const };

    return (
        <Modal
            open={!!delivery}
            title={editable ? t("Edit parcel {barcode}", { barcode: delivery?.barcode ?? "" }) : t("Change the price of parcel {barcode}", { barcode: delivery?.barcode ?? "" })}
            okText={editable ? t("Save at Colissimo") : t("Request the change")}
            cancelText={t("Cancel")}
            onOk={save}
            onCancel={onClose}
            confirmLoading={saving}
            destroyOnHidden
            width={editable ? 640 : 480}
        >
            {editable ? (
                <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                    {t("The parcel is still waiting for pickup: Colissimo updates it at once, and the order keeps the corrected details. Once the label is printed, only the price can change.")}
                </Text>
            ) : (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    title={t("Colissimo already has this parcel")}
                    description={t("Only its price can change now: Colissimo receives the request and answers later. Until then the parcel keeps its price.")}
                />
            )}
            <Form form={form} layout="vertical" requiredMark={false}>
                {editable && (
                    <>
                        <Form.Item name="nom" label={t("Customer name")} rules={[{ required: true, message: t("Required") }]}>
                            <Input maxLength={100} />
                        </Form.Item>
                        <div style={row}>
                            <Form.Item name="tel" label={t("Phone")} rules={[{ required: true, message: t("Required") }, phoneRule]} style={{ flex: "1 1 200px" }}>
                                <Input inputMode="numeric" maxLength={8} />
                            </Form.Item>
                            <Form.Item name="tel2" label={t("Second phone (optional)")} rules={[phoneRule]} style={{ flex: "1 1 200px" }}>
                                <Input inputMode="numeric" maxLength={8} />
                            </Form.Item>
                        </div>
                        <div style={row}>
                            <Form.Item name="gouvernerat" label={t("Governorate")} rules={[{ required: true, message: t("Required") }]} style={{ flex: "1 1 200px" }}>
                                <Select showSearch options={COLISSIMO_GOVERNORATES.map((name) => ({ value: name, label: name }))} />
                            </Form.Item>
                            <Form.Item name="ville" label={t("City")} rules={[{ required: true, message: t("Required") }]} style={{ flex: "1 1 200px" }}>
                                <Input maxLength={100} />
                            </Form.Item>
                        </div>
                        <Form.Item name="adresse" label={t("Address")} rules={[{ required: true, message: t("Required") }]}>
                            <Input.TextArea rows={2} maxLength={250} />
                        </Form.Item>
                        <Form.Item name="designation" label={t("Contents")} rules={[{ required: true, message: t("Required") }]}>
                            <Input maxLength={250} />
                        </Form.Item>
                    </>
                )}
                <div style={row}>
                    {editable && (
                        <Form.Item name="nb_article" label={t("Number of items")} rules={[{ required: true, message: t("Required") }]} style={{ flex: "1 1 140px" }}>
                            <InputNumber min={1} max={999} precision={0} style={{ width: "100%" }} />
                        </Form.Item>
                    )}
                    <Form.Item name="prix" label={t("Cash to collect (TND)")} rules={[{ required: true, message: t("Required") }]} style={{ flex: "1 1 140px" }}>
                        <InputNumber min={0} max={99999.999} step={1} precision={3} style={{ width: "100%" }} />
                    </Form.Item>
                </div>
                {!editable && (
                    <Form.Item name="reason" label={t("Reason (optional, sent to Colissimo)")}>
                        <Input maxLength={255} />
                    </Form.Item>
                )}
            </Form>
        </Modal>
    );
}
