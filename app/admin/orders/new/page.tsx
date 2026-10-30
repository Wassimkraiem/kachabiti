"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Checkbox, Col, Form, Input, InputNumber, Row, Select, Space, Tag, Typography } from "antd";
import { WarningOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { useAdminRole } from "@/lib/admin-role-context";
import { governorateOptions } from "@/lib/colissimo-data";
import { CHANNEL_LABELS, MANUAL_CHANNELS, STAGE_COLORS, STAGE_LABELS, type CustomerStage } from "@/lib/erp/constants";
import ParcelProducts, { type ProductLine, type QuotedLine } from "@/components/admin/delivery/ParcelProducts";
import { AgentSelect, CampaignSelect, PageHeader } from "@/components/admin/erp/ui";
import { api, formatDate, formatMoney, useApi } from "@/components/admin/erp/erp-client";
import { ORDER_STATUS_COLORS, orderStatusLabel } from "@/components/admin/order-status";

const { Text } = Typography;

interface Lookup {
    customer: { id: string; full_name: string; email: string | null; governorate: string | null; city: string | null; address: string | null; stage: CustomerStage; notes: string | null } | null;
    open_orders: { id: string; order_number: string; status: string; total: number; created_at: string; channel: string }[];
}

/**
 * Admin → New order: an order taken on Facebook, Instagram, TikTok, WhatsApp or by phone. Typing
 * the phone finds the customer (and fills their address) and warns about orders of theirs still in
 * progress, so the same order isn't entered twice. Prices come from the catalog; the order starts
 * "to confirm" (or confirmed if the customer already agreed) and is then validated as usual.
 */
export default function NewOrderPage() {
    const { t, locale } = useAdminT();
    const router = useRouter();
    const { id: myId, isAdmin } = useAdminRole();
    const [form] = Form.useForm();
    const [lines, setLines] = useState<ProductLine[]>([{ key: 1, quantity: 1 }]);
    const [quoted, setQuoted] = useState<QuotedLine[] | null>(null);
    const [lookup, setLookup] = useState<Lookup | null>(null);
    const [saving, setSaving] = useState(false);
    const phone: string = Form.useWatch("phone", form) ?? "";
    const discount: number = Form.useWatch("discount_amount", form) ?? 0;
    const shipping: number | null = Form.useWatch("shipping_cost", form) ?? null;
    // The usual delivery fee (Business settings) starts filled in; the agent can change it.
    const fee = useApi<{ fee: number }>("/api/sales/orders/delivery-fee").data?.fee;
    useEffect(() => {
        if (fee !== undefined && form.getFieldValue("shipping_cost") == null) form.setFieldValue("shipping_cost", fee);
    }, [fee, form]);

    // Look the phone up once it has its 8 digits.
    useEffect(() => {
        const digits = phone.replace(/\D/g, "");
        if (digits.length !== 8) {
            setLookup(null);
            return;
        }
        let alive = true;
        api<Lookup>(`/api/sales/orders?phone=${digits}`)
            .then((result) => {
                if (!alive) return;
                setLookup(result);
                const c = result.customer;
                if (c) {
                    const [first, ...rest] = c.full_name.split(/\s+/);
                    const current = form.getFieldsValue();
                    form.setFieldsValue({
                        first_name: current.first_name || first,
                        last_name: current.last_name || rest.join(" "),
                        email: current.email || c.email || undefined,
                        governorate: current.governorate || c.governorate || undefined,
                        city: current.city || c.city || undefined,
                        address: current.address || c.address || undefined,
                    });
                }
            })
            .catch(() => alive && setLookup(null));
        return () => {
            alive = false;
        };
    }, [phone, form]);

    const subtotal = useMemo(() => (quoted ?? []).reduce((s, l) => s + l.subtotal, 0), [quoted]);

    const submit = async () => {
        const values = await form.validateFields();
        if (!quoted?.length) {
            message.warning(t("Add at least one product (with its size/colour)."));
            return;
        }
        setSaving(true);
        try {
            const created = await api<{ id: string; order_number: string }>("/api/sales/orders", {
                method: "POST",
                body: {
                    customer: {
                        phone: values.phone.replace(/\D/g, ""),
                        first_name: values.first_name,
                        last_name: values.last_name ?? "",
                        email: values.email ?? "",
                        governorate: values.governorate,
                        city: values.city,
                        address: values.address,
                    },
                    items: lines.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id, variant_id: l.variant_id ?? null, quantity: l.quantity })),
                    channel: values.channel,
                    campaign_id: values.campaign_id ?? null,
                    shipping_cost: values.shipping_cost ?? undefined,
                    discount_amount: values.discount_amount ?? 0,
                    notes: values.notes ?? undefined,
                    assigned_to: values.assigned_to === undefined ? undefined : values.assigned_to,
                    confirmed: values.confirmed ?? false,
                },
            });
            message.success(t("Order {order_number} created", { order_number: created.order_number }));
            router.push(`/admin/orders/${created.id}`);
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <PageHeader
                title={t("New order")}
                subtitle={t("An order taken on social media or by phone. It is checked for duplicates and priced from the catalog.")}
                crumbs={[{ title: t("Orders"), href: "/admin/orders" }]}
            />
            <Form form={form} layout="vertical" requiredMark="optional" initialValues={{ channel: "facebook", discount_amount: 0, confirmed: false, assigned_to: myId ?? undefined }}>
                <Row gutter={[16, 16]}>
                    <Col xs={24} lg={14}>
                        <Card title={t("Customer")}>
                            <Row gutter={12}>
                                <Col xs={24} md={12}>
                                    <Form.Item name="phone" label={t("Phone")} rules={[{ required: true, pattern: /^\s*[24579](\s*\d){7}\s*$/, message: t("8 digits, starting with 2, 4, 5, 7 or 9") }]}>
                                        <Input inputMode="tel" placeholder="22 123 456" autoFocus />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name="channel" label={t("Where did the order come from?")} rules={[{ required: true }]}>
                                        <Select options={MANUAL_CHANNELS.map((c) => ({ value: c, label: t(CHANNEL_LABELS[c]) }))} />
                                    </Form.Item>
                                </Col>
                            </Row>

                            {lookup?.customer && (
                                <Alert
                                    style={{ marginBottom: 16 }}
                                    type="info"
                                    showIcon
                                    title={<span>{t("Known customer")}: <Link href={`/admin/customers/${lookup.customer.id}`}>{lookup.customer.full_name || t("(no name)")}</Link> <Tag color={STAGE_COLORS[lookup.customer.stage]}>{t(STAGE_LABELS[lookup.customer.stage])}</Tag></span>}
                                    description={lookup.customer.notes || undefined}
                                />
                            )}
                            {!!lookup?.open_orders.length && (
                                <Alert
                                    style={{ marginBottom: 16 }}
                                    type="warning"
                                    showIcon
                                    icon={<WarningOutlined />}
                                    title={t("This customer already has {count} order(s) in progress. Is this a duplicate?", { count: lookup.open_orders.length })}
                                    description={
                                        <Space orientation="vertical" size={2}>
                                            {lookup.open_orders.map((o) => (
                                                <span key={o.id}>
                                                    <Link href={`/admin/orders/${o.id}`}>{o.order_number}</Link> · <Tag color={ORDER_STATUS_COLORS[o.status]}>{t(orderStatusLabel(o.status))}</Tag>
                                                    {formatMoney(o.total, locale)} · {formatDate(o.created_at, locale, true)}
                                                </span>
                                            ))}
                                        </Space>
                                    }
                                />
                            )}

                            <Row gutter={12}>
                                <Col xs={24} md={12}><Form.Item name="first_name" label={t("First name")} rules={[{ required: true }]}><Input /></Form.Item></Col>
                                <Col xs={24} md={12}><Form.Item name="last_name" label={t("Last name")}><Input /></Form.Item></Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name="governorate" label={t("Governorate")} rules={[{ required: true }]}>
                                        <Select showSearch optionFilterProp="label" options={governorateOptions(locale)} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}><Form.Item name="city" label={t("City")} rules={[{ required: true }]}><Input /></Form.Item></Col>
                                <Col xs={24}><Form.Item name="address" label={t("Address")} rules={[{ required: true }]}><Input /></Form.Item></Col>
                                <Col xs={24} md={12}><Form.Item name="email" label={t("Email")} rules={[{ type: "email" }]}><Input /></Form.Item></Col>
                            </Row>
                        </Card>
                        <Card title={t("Products")} style={{ marginTop: 16 }}>
                            <ParcelProducts lines={lines} onChange={setLines} onQuote={setQuoted} />
                        </Card>
                    </Col>

                    <Col xs={24} lg={10}>
                        <Card title={t("Order")}>
                            <Form.Item name="campaign_id" label={t("Campaign (if it came from an ad)")}>
                                <CampaignSelect />
                            </Form.Item>
                            <Form.Item name="assigned_to" label={t("Handled by")}>
                                <AgentSelect filter={isAdmin ? undefined : (m) => m.user_id === myId} />
                            </Form.Item>
                            <Row gutter={12}>
                                <Col span={12}>
                                    <Form.Item name="shipping_cost" label={t("Delivery fee")} tooltip={t("The usual fee from Business settings. Change it for this order if needed, or empty it to apply free shipping above the threshold.")}>
                                        <InputNumber min={0} precision={3} style={{ width: "100%" }} suffix="TND" />
                                    </Form.Item>
                                </Col>
                                <Col span={12}>
                                    <Form.Item name="discount_amount" label={t("Discount")}>
                                        <InputNumber min={0} max={subtotal || undefined} precision={3} style={{ width: "100%" }} suffix="TND" />
                                    </Form.Item>
                                </Col>
                            </Row>
                            <Form.Item name="notes" label={t("Notes")}>
                                <Input.TextArea rows={3} maxLength={2000} />
                            </Form.Item>
                            <Form.Item name="confirmed" valuePropName="checked">
                                <Checkbox>{t("The customer already confirmed")}</Checkbox>
                            </Form.Item>

                            <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
                                <Line label={t("Products")} value={formatMoney(subtotal, locale)} />
                                {discount > 0 && <Line label={t("Discount")} value={`− ${formatMoney(discount, locale)}`} />}
                                <Line label={t("Delivery fee")} value={shipping === null ? t("Usual fee") : formatMoney(shipping, locale)} />
                                <Line label={t("To collect")} value={shipping === null ? `${formatMoney(Math.max(0, subtotal - discount), locale)} + ${t("delivery")}` : formatMoney(Math.max(0, subtotal - discount) + shipping, locale)} strong />
                            </div>
                            <Button type="primary" block size="large" style={{ marginTop: 16 }} loading={saving} onClick={submit}>
                                {t("Create order")}
                            </Button>
                            <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
                                {t("The order waits for confirmation, then Validate creates its Colissimo parcel and takes the items out of stock.")}
                            </Text>
                        </Card>
                    </Col>
                </Row>
            </Form>
        </div>
    );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontWeight: strong ? 600 : 400 }}>
            <span>{label}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
        </div>
    );
}
