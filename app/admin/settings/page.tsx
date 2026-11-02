"use client";

import { useEffect, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import Link from "next/link";
import { Alert, Button, Card, Col, DatePicker, Form, InputNumber, Popconfirm, Row, Space, Typography } from "antd";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { PageHeader } from "@/components/admin/erp/ui";
import { api, useApi } from "@/components/admin/erp/erp-client";

const { Text } = Typography;

interface Settings {
    sales?: { pending_alert_hours?: number; late_delivery_days?: number; duplicate_window_days?: number };
    pos?: { max_discount_percent?: number };
    analytics?: { start_date?: string | null };
    delivery_fee?: number;
}

/**
 * Admin → Business settings (owners and admins): when alerts fire, how far back duplicates are
 * looked for, the biggest discount staff can give, and the analytics start date ("reset").
 * Accounting settings live in Accounting.
 */
export default function SettingsPage() {
    const { t } = useAdminT();
    const { data, loading, reload } = useApi<Settings>("/api/admin/erp-settings");
    const [form] = Form.useForm();
    useEffect(() => {
        if (data) form.setFieldsValue(data);
    }, [data, form]);

    const start = data?.analytics?.start_date ?? null;
    const [picked, setPicked] = useState<Dayjs | null>(null);
    // Reset = count Business overview, Agent performance, Objectives and My day from a date.
    const setStart = async (date: string | null) => {
        try {
            await api("/api/admin/erp-settings", { method: "PUT", body: { analytics: { start_date: date } } });
            message.success(date ? t("Analytics now count from {date}", { date: dayjs(date).format("DD/MM/YYYY") }) : t("Analytics show all history again"));
            setPicked(null);
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const save = async () => {
        const values = await form.validateFields();
        try {
            await api("/api/admin/erp-settings", { method: "PUT", body: { sales: values.sales, pos: values.pos, delivery_fee: values.delivery_fee ?? undefined } });
            message.success(t("Saved"));
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    return (
        <div>
            <PageHeader title={t("Business settings")} subtitle={t("Rules for alerts, duplicates and discounts, and the analytics reset.")} extra={<Button type="primary" onClick={save}>{t("Save")}</Button>} />
            <Form form={form} layout="vertical">
                <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                        <Card title={t("Orders and alerts")} loading={loading}>
                            <Form.Item name={["sales", "pending_alert_hours"]} label={t("Alert when an order waits for confirmation longer than (hours)")}><InputNumber min={1} max={720} style={{ width: "100%" }} /></Form.Item>
                            <Form.Item name={["sales", "late_delivery_days"]} label={t("Alert when a parcel is not delivered after (days)")}><InputNumber min={1} max={60} style={{ width: "100%" }} /></Form.Item>
                            <Form.Item name={["sales", "duplicate_window_days"]} label={t("Look for duplicate orders over the last (days)")}><InputNumber min={1} max={365} style={{ width: "100%" }} /></Form.Item>
                            <Text type="secondary">{t("Alerts are checked every morning and also cover low stock, bills due and expiring documents.")}</Text>
                        </Card>
                        <Card title={t("Delivery fee")} loading={loading} style={{ marginTop: 16 }}>
                            <Form.Item name="delivery_fee" label={t("Usual delivery fee in Tunisia (TND)")}><InputNumber min={0} max={1000} precision={3} style={{ width: "100%" }} suffix="TND" /></Form.Item>
                            <Text type="secondary">{t("Charged at the website checkout and filled in on New order and New parcel, where it can be changed for one order.")}</Text>
                        </Card>
                    </Col>
                    <Col xs={24} md={12}>
                        <Card title={t("Discounts")} loading={loading}>
                            <Form.Item name={["pos", "max_discount_percent"]} label={t("Largest discount staff can give, at the till and on manual orders (%)")}><InputNumber min={0} max={100} style={{ width: "100%" }} /></Form.Item>
                            <Text type="secondary">{t("Owners and admins can give any discount.")}</Text>
                        </Card>
                        <Card title={t("Analytics")} loading={loading} style={{ marginTop: 16 }}>
                            <Text type="secondary">{t("Reset the numbers: the Business overview, Agent performance, Objectives and My day count only from a date. Nothing is deleted, and you can go back to the full history at any time.")}</Text>
                            <Alert
                                type={start ? "warning" : "info"}
                                showIcon
                                style={{ margin: "12px 0" }}
                                title={start ? t("Figures count from {date}.", { date: dayjs(start).format("DD/MM/YYYY") }) : t("Figures include the full history.")}
                            />
                            <Space wrap>
                                <Popconfirm title={t("Count analytics from today?")} onConfirm={() => setStart(dayjs().format("YYYY-MM-DD"))}>
                                    <Button danger>{t("Reset from today")}</Button>
                                </Popconfirm>
                                <DatePicker value={picked} onChange={setPicked} placeholder={t("Pick a date")} />
                                <Button disabled={!picked} onClick={() => picked && setStart(picked.format("YYYY-MM-DD"))}>{t("Count from this date")}</Button>
                                {start && <Button type="link" onClick={() => setStart(null)}>{t("Show all history")}</Button>}
                            </Space>
                        </Card>
                        <Card title={t("Elsewhere")} style={{ marginTop: 16 }}>
                            <p><Link href="/admin/finance/accounting">{t("Accounting")}</Link> · {t("company details, VAT, stamp duty, accounts")}</p>
                            <p><Link href="/admin/stock/settings">{t("Stock settings")}</Link> · {t("locations (add one per shop or workshop)")}</p>
                            <p><Link href="/admin/team">{t("Team")}</Link> · {t("roles and permissions")}</p>
                        </Card>
                    </Col>
                </Row>
            </Form>
        </div>
    );
}
