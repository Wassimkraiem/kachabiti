"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import dayjs from "dayjs";
import { Alert, Button, Card, Checkbox, Col, DatePicker, Descriptions, Empty, Form, Input, Modal, Popconfirm, Row, Select, Space, Table, Tag, Timeline, Typography } from "antd";
import { DeleteOutlined, EditOutlined, PhoneOutlined, PlusOutlined, SendOutlined, WhatsAppOutlined } from "@ant-design/icons";
import { messageText } from "@/components/admin/erp/messenger-media";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { useAdminRole } from "@/lib/admin-role-context";
import { governorateOptions } from "@/lib/colissimo-data";
import { CHANNELS, CHANNEL_LABELS, CUSTOMER_STAGES, STAGE_COLORS, STAGE_LABELS, type CustomerStage } from "@/lib/erp/constants";
import { AgentSelect, ChannelTag, Kpi, ListRow, PageHeader } from "@/components/admin/erp/ui";
import { api, formatDate, formatMoney, useApi } from "@/components/admin/erp/erp-client";
import { ORDER_STATUS_COLORS, PAYMENT_STATUS_COLORS, PAYMENT_STATUS_LABELS, orderStatusLabel } from "@/components/admin/order-status";

const { Text, Paragraph } = Typography;

interface Customer {
    id: string;
    phone: string | null;
    phone_alt: string | null;
    full_name: string;
    email: string | null;
    governorate: string | null;
    city: string | null;
    address: string | null;
    channel: string;
    stage: CustomerStage;
    assigned_to: string | null;
    assigned_to_email: string | null;
    tags: string[];
    notes: string | null;
    external_ids: Record<string, string>;
    created_at: string;
    anonymized_at: string | null;
}

interface Interaction {
    id: string;
    channel: string;
    direction: "in" | "out" | "note";
    body: string;
    created_at: string;
    created_by_email: string | null;
    sender_name: string | null;
    order_id: string | null;
}

interface Task {
    id: string;
    title: string;
    notes: string | null;
    due_at: string;
    done_at: string | null;
    assigned_to_email: string | null;
}

interface Detail {
    customer: Customer;
    orders: { id: string; order_number: string; status: string; payment_status: string; total: number; channel: string; created_at: string; assigned_to_email: string | null; items: { product_name: string; variant_label: string | null; quantity: number }[] }[];
    interactions: Interaction[];
    tasks: Task[];
    stats: { orders: number; delivered: number; returned: number; spent: number; delivery_rate: number | null };
}

const SENDABLE = ["facebook", "instagram", "whatsapp"];

/**
 * A customer's record: details and pipeline stage, their orders, the conversation (messages
 * received on Messenger/Instagram/WhatsApp, replies, calls and notes), and follow-ups.
 */
export default function CustomerPage() {
    const { t, locale } = useAdminT();
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { isAdmin } = useAdminRole();
    const { data, loading, error, reload } = useApi<Detail>(`/api/customers?id=${id}`);
    const [editing, setEditing] = useState(false);
    const [form] = Form.useForm();
    const [noteForm] = Form.useForm();
    const [taskForm] = Form.useForm();
    const [posting, setPosting] = useState(false);
    const [taskOpen, setTaskOpen] = useState(false);
    const c = data?.customer;
    const money = (n: number) => formatMoney(n, locale, 0);

    // Opening the record marks its messages read.
    useEffect(() => {
        if (id) api("/api/crm/interactions", { method: "PUT", body: { customer_id: id } }).catch(() => undefined);
    }, [id]);

    const save = async () => {
        const values = await form.validateFields();
        try {
            await api("/api/customers", { method: "PUT", body: { id, ...values, tags: values.tags ?? [] } });
            message.success(t("Saved"));
            setEditing(false);
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const setStage = async (stage: CustomerStage) => {
        try {
            await api("/api/customers", { method: "PUT", body: { id, stage } });
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const post = async (send: boolean) => {
        const values = await noteForm.validateFields();
        setPosting(true);
        try {
            await api("/api/crm/interactions", {
                method: "POST",
                body: { customer_id: id, channel: values.channel, direction: send ? "out" : values.direction, body: values.body, send },
            });
            noteForm.setFieldValue("body", "");
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setPosting(false);
        }
    };

    const addTask = async () => {
        const values = await taskForm.validateFields();
        try {
            await api("/api/crm/tasks", { method: "POST", body: { customer_id: id, title: values.title, notes: values.notes, due_at: values.due_at.toISOString(), assigned_to: values.assigned_to ?? undefined } });
            setTaskOpen(false);
            taskForm.resetFields();
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const toggleTask = async (task: Task) => {
        await api("/api/crm/tasks", { method: "PUT", body: { id: task.id, done: !task.done_at } }).catch((e) => message.error(t((e as Error).message)));
        reload();
    };

    const anonymize = async () => {
        try {
            await api("/api/customers", { method: "PATCH", body: { action: "anonymize", id } });
            message.success(t("Personal data erased"));
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const remove = async () => {
        try {
            await api(`/api/customers?id=${id}`, { method: "DELETE" });
            router.push("/admin/customers");
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    if (error) return <Alert type="error" showIcon title={t(error)} />;
    if (!c) return <Card loading={loading} />;

    const replyChannel = c.external_ids?.whatsapp || c.phone ? "whatsapp" : c.external_ids?.instagram ? "instagram" : c.external_ids?.messenger ? "facebook" : "phone";

    return (
        <div>
            <PageHeader
                title={c.full_name || t("(no name)")}
                subtitle={<Space wrap><Tag color={STAGE_COLORS[c.stage]}>{t(STAGE_LABELS[c.stage])}</Tag><ChannelTag channel={c.channel} /><span>{t("Customer since {date}", { date: formatDate(c.created_at, locale) })}</span></Space>}
                crumbs={[{ title: t("Customers"), href: "/admin/customers" }]}
                extra={
                    <>
                        {c.phone && <a href={`tel:${c.phone}`}><Button icon={<PhoneOutlined />}>{t("Call")}</Button></a>}
                        {c.phone && <a href={`https://wa.me/216${c.phone}`} target="_blank" rel="noreferrer"><Button icon={<WhatsAppOutlined />}>WhatsApp</Button></a>}
                        <Link href={`/admin/orders/new`}><Button type="primary" icon={<PlusOutlined />}>{t("New order")}</Button></Link>
                    </>
                }
            />
            {c.anonymized_at && <Alert type="info" showIcon style={{ marginBottom: 16 }} title={t("Personal data erased on {date}.", { date: formatDate(c.anonymized_at, locale) })} />}

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={12} md={6}><Kpi title={t("Orders")} value={data.stats.orders} /></Col>
                <Col xs={12} md={6}><Kpi title={t("Delivered")} value={data.stats.delivered} sub={data.stats.returned ? t("{count} returned", { count: data.stats.returned }) : undefined} /></Col>
                <Col xs={12} md={6}><Kpi title={t("Spent")} value={money(data.stats.spent)} /></Col>
                <Col xs={12} md={6}><Kpi title={t("Delivery rate")} value={data.stats.delivery_rate === null ? "—" : `${data.stats.delivery_rate}%`} color={data.stats.delivery_rate !== null && data.stats.delivery_rate < 60 ? "#cf1322" : undefined} hint={t("Low rates mean this customer often refuses parcels.")} /></Col>
            </Row>

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={9}>
                    <Card
                        title={t("Details")}
                        extra={<Button size="small" icon={<EditOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ ...c }); setEditing(true); }}>{t("Edit")}</Button>}
                    >
                        <div style={{ marginBottom: 12 }}>
                            <Text type="secondary" style={{ display: "block", fontSize: 12 }}>{t("Stage")}</Text>
                            <Select value={c.stage} onChange={setStage} style={{ width: "100%" }} options={CUSTOMER_STAGES.map((s) => ({ value: s, label: t(STAGE_LABELS[s]) }))} />
                        </div>
                        <Descriptions column={1} size="small">
                            <Descriptions.Item label={t("Phone")}>{[c.phone, c.phone_alt].filter(Boolean).join(" / ") || "—"}</Descriptions.Item>
                            <Descriptions.Item label={t("Email")}>{c.email ?? "—"}</Descriptions.Item>
                            <Descriptions.Item label={t("Address")}>{[c.address, c.city, c.governorate].filter(Boolean).join(", ") || "—"}</Descriptions.Item>
                            <Descriptions.Item label={t("Handled by")}>{c.assigned_to_email ?? "—"}</Descriptions.Item>
                            <Descriptions.Item label={t("Tags")}>{c.tags.length ? c.tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : "—"}</Descriptions.Item>
                        </Descriptions>
                        {c.notes && <Paragraph style={{ whiteSpace: "pre-wrap", background: "#fafafa", padding: 8, borderRadius: 6 }}>{c.notes}</Paragraph>}
                        {isAdmin && !c.anonymized_at && (
                            <Space wrap style={{ marginTop: 8 }}>
                                <Popconfirm title={t("Erase this customer's personal data?")} description={t("Name, phone, address and messages are erased for good. Orders keep their amounts.")} onConfirm={anonymize}>
                                    <Button size="small" danger>{t("Erase personal data")}</Button>
                                </Popconfirm>
                                <Popconfirm title={t("Delete this customer record?")} description={t("Their orders stay.")} onConfirm={remove}>
                                    <Button size="small" danger type="text" icon={<DeleteOutlined />}>{t("Delete")}</Button>
                                </Popconfirm>
                            </Space>
                        )}
                    </Card>

                    <Card
                        title={t("Follow-ups")}
                        style={{ marginTop: 16 }}
                        extra={<Button size="small" icon={<PlusOutlined />} onClick={() => { taskForm.resetFields(); taskForm.setFieldsValue({ due_at: dayjs().add(1, "day").hour(10).minute(0) }); setTaskOpen(true); }}>{t("Add")}</Button>}
                    >
                        {!data.tasks.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("No follow-ups.")} /> : (
                            <div>
                                {data.tasks.map((task) => (
                                    <ListRow
                                        key={task.id}
                                        title={
                                            <Checkbox checked={!!task.done_at} onChange={() => toggleTask(task)}>
                                                <span style={{ textDecoration: task.done_at ? "line-through" : undefined }}>{task.title}</span>
                                            </Checkbox>
                                        }
                                        description={
                                            <Text type={!task.done_at && dayjs(task.due_at).isBefore(dayjs()) ? "danger" : "secondary"} style={{ fontSize: 12 }}>
                                                {formatDate(task.due_at, locale, true)}{task.assigned_to_email ? ` · ${task.assigned_to_email}` : ""}
                                            </Text>
                                        }
                                    />
                                ))}
                            </div>
                        )}
                    </Card>
                </Col>

                <Col xs={24} xl={15}>
                    <Card title={t("Conversation")}>
                        <Form form={noteForm} layout="vertical" initialValues={{ channel: replyChannel, direction: "note" }}>
                            <Space wrap style={{ marginBottom: 8 }}>
                                <Form.Item name="channel" noStyle>
                                    <Select style={{ width: 150 }} options={[...CHANNELS.filter((ch) => ch !== "website"), "email"].map((ch) => ({ value: ch, label: ch === "email" ? t("Email") : t(CHANNEL_LABELS[ch as keyof typeof CHANNEL_LABELS]) }))} />
                                </Form.Item>
                                <Form.Item name="direction" noStyle>
                                    <Select style={{ width: 190 }} options={[{ value: "note", label: t("Internal note / call") }, { value: "in", label: t("What the customer said") }, { value: "out", label: t("What we answered") }]} />
                                </Form.Item>
                            </Space>
                            <Form.Item name="body" rules={[{ required: true, message: t("Write something") }]} style={{ marginBottom: 8 }}>
                                <Input.TextArea rows={3} maxLength={5000} placeholder={t("Call summary, request, answer...")} />
                            </Form.Item>
                            <Space wrap>
                                <Button onClick={() => post(false)} loading={posting}>{t("Save to history")}</Button>
                                <Form.Item noStyle shouldUpdate>
                                    {() => SENDABLE.includes(noteForm.getFieldValue("channel")) && (
                                        <Button type="primary" icon={<SendOutlined />} onClick={() => post(true)} loading={posting}>{t("Send reply")}</Button>
                                    )}
                                </Form.Item>
                            </Space>
                        </Form>
                        <div style={{ marginTop: 20, maxHeight: 520, overflowY: "auto" }}>
                            {!data.interactions.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("No conversation yet.")} /> : (
                                <Timeline
                                    items={data.interactions.map((i) => ({
                                        color: i.direction === "in" ? "blue" : i.direction === "out" ? "green" : "gray",
                                        content: (
                                            <div>
                                                <Space size={4} wrap>
                                                    <ChannelTag channel={i.channel === "email" ? "other" : i.channel} />
                                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                                        {i.direction === "in" ? t("Customer") : i.direction === "out" ? t("We replied") : t("Note")}
                                                        {" · "}{formatDate(i.created_at, locale, true)}
                                                        {i.created_by_email ? ` · ${i.created_by_email}` : i.sender_name ? ` · ${i.sender_name}` : ""}
                                                    </Text>
                                                </Space>
                                                <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{messageText(i.body, t)}</div>
                                            </div>
                                        ),
                                    }))}
                                />
                            )}
                        </div>
                    </Card>

                    <Card title={t("Orders")} style={{ marginTop: 16 }}>
                        <Table
                            size="small"
                            rowKey="id"
                            dataSource={data.orders}
                            pagination={{ pageSize: 10, hideOnSinglePage: true }}
                            scroll={{ x: "max-content" }}
                            locale={{ emptyText: t("No orders yet.") }}
                            columns={[
                                { title: t("Order #"), dataIndex: "order_number", render: (v: string, r) => <Link href={`/admin/orders/${r.id}`}>{v}</Link> },
                                { title: t("Date"), dataIndex: "created_at", render: (v: string) => formatDate(v, locale) },
                                { title: t("Products"), key: "items", render: (_, r) => r.items.map((i) => `${i.quantity}× ${i.product_name}${i.variant_label ? ` (${i.variant_label})` : ""}`).join(", ") },
                                { title: t("Total"), dataIndex: "total", render: (v: number) => money(v) },
                                { title: t("Status"), dataIndex: "status", render: (v: string) => <Tag color={ORDER_STATUS_COLORS[v]}>{t(orderStatusLabel(v))}</Tag> },
                                { title: t("Payment"), dataIndex: "payment_status", render: (v: string) => <Tag color={PAYMENT_STATUS_COLORS[v]}>{t(PAYMENT_STATUS_LABELS[v] ?? v)}</Tag> },
                                { title: t("Came from"), dataIndex: "channel", render: (v: string) => <ChannelTag channel={v} /> },
                            ]}
                        />
                    </Card>
                </Col>
            </Row>

            <Modal open={editing} title={t("Edit customer")} onCancel={() => setEditing(false)} onOk={save} okText={t("Save")} cancelText={t("Cancel")} forceRender width={640}>
                <Form form={form} layout="vertical">
                    <Form.Item name="full_name" label={t("Name")} rules={[{ required: true }]}><Input /></Form.Item>
                    <Row gutter={12}>
                        <Col span={12}><Form.Item name="phone" label={t("Phone")}><Input /></Form.Item></Col>
                        <Col span={12}><Form.Item name="phone_alt" label={t("Second phone")}><Input /></Form.Item></Col>
                        <Col span={12}><Form.Item name="email" label={t("Email")}><Input /></Form.Item></Col>
                        <Col span={12}><Form.Item name="channel" label={t("Came from")}><Select options={CHANNELS.map((ch) => ({ value: ch, label: t(CHANNEL_LABELS[ch]) }))} /></Form.Item></Col>
                        <Col span={12}><Form.Item name="governorate" label={t("Governorate")}><Select allowClear showSearch optionFilterProp="label" options={governorateOptions(locale)} /></Form.Item></Col>
                        <Col span={12}><Form.Item name="city" label={t("City")}><Input /></Form.Item></Col>
                    </Row>
                    <Form.Item name="address" label={t("Address")}><Input /></Form.Item>
                    <Form.Item name="tags" label={t("Tags")}><Select mode="tags" tokenSeparators={[","]} /></Form.Item>
                    {isAdmin && <Form.Item name="assigned_to" label={t("Handled by")}><AgentSelect /></Form.Item>}
                    <Form.Item name="notes" label={t("Notes")}><Input.TextArea rows={4} /></Form.Item>
                </Form>
            </Modal>

            <Modal open={taskOpen} title={t("New follow-up")} onCancel={() => setTaskOpen(false)} onOk={addTask} okText={t("Save")} cancelText={t("Cancel")} forceRender>
                <Form form={taskForm} layout="vertical">
                    <Form.Item name="title" label={t("What to do")} rules={[{ required: true }]}><Input placeholder={t("Call back about the size, send photos...")} /></Form.Item>
                    <Form.Item name="due_at" label={t("When")} rules={[{ required: true }]}><DatePicker showTime={{ format: "HH:mm" }} format="DD/MM/YYYY HH:mm" style={{ width: "100%" }} /></Form.Item>
                    <Form.Item name="assigned_to" label={t("Who")}><AgentSelect allowNobody={false} placeholder={t("Me")} /></Form.Item>
                    <Form.Item name="notes" label={t("Notes")}><Input.TextArea rows={2} /></Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
