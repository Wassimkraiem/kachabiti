"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Alert, Button, Card, Checkbox, Col, Form, Input, InputNumber, Row, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { ChannelTag, Kpi, PageHeader } from "@/components/admin/erp/ui";
import { BarChart, TargetBar } from "@/components/admin/erp/charts";
import { api, formatDate, useApi } from "@/components/admin/erp/erp-client";

const { Text, Paragraph } = Typography;

interface Settings {
    enabled: boolean;
    channels: string[];
    monthly_budget_usd: number;
    knowledge: string;
    handoff_message: string;
    model: string;
    escalation_model: string;
}

interface Run {
    id: string;
    created_at: string;
    customer_id: string | null;
    customer: { full_name: string; phone: string | null } | null;
    channel: string;
    model: string;
    prompt_version: string;
    outcome: "replied" | "handoff" | "error" | "transcribed";
    handoff_reason: string | null;
    reply: string | null;
    error: string | null;
    cost_usd: number;
    latency_ms: number;
    input_tokens: number;
    cache_read_tokens: number;
    output_tokens: number;
    audio_seconds: number;
    tool_calls: { name: string; input: unknown; output: unknown }[];
    trace_id: string | null;
}

interface Overview {
    settings: Settings;
    spent: number;
    days: { day: string; turns: number; handoffs: number; cost: number }[];
    runs: Run[];
    waiting: { id: string; full_name: string; phone: string | null; channel: string; bot_handoff_reason: string | null; bot_handoff_at: string | null; assigned_to_email: string | null }[];
    prompt_version: string;
    connected: { anthropic: boolean; groq: boolean; langfuse: boolean; langfuse_url: string; meta_app_id: boolean; webhook: boolean; facebook: boolean; instagram: boolean; whatsapp: boolean };
}

const OUTCOME_COLORS: Record<Run["outcome"], string> = { replied: "green", handoff: "orange", error: "red", transcribed: "default" };
const OUTCOME_LABELS: Record<Run["outcome"], string> = { replied: "Replied", handoff: "Handed to an agent", error: "Error", transcribed: "Voice note transcribed" };
const MODELS = [
    { value: "claude-haiku-5-5", label: "Claude Haiku 5.5 ($0.10 / $0.50 per M tokens)" },
    { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 ($2 / $10 per M tokens)" },
];
const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;

/**
 * Admin → Assistant (owners and admins): the support bot that answers Messenger, Instagram and
 * WhatsApp (docs/SUPPORT-BOT.md). Settings, this month's AI spend against the budget, every turn
 * the bot took (tools it called, cost, Langfuse trace) and the customers waiting for an agent.
 */
export default function AssistantPage() {
    const { t, locale } = useAdminT();
    const { data, loading, reload } = useApi<Overview>("/api/admin/assistant");
    const [form] = Form.useForm<Settings>();
    useEffect(() => {
        if (data) form.setFieldsValue(data.settings);
    }, [data, form]);

    const save = async () => {
        const values = await form.validateFields();
        try {
            await api("/api/admin/assistant", { method: "PUT", body: values });
            message.success(t("Saved"));
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const c = data?.connected;
    const budget = data?.settings.monthly_budget_usd ?? 0;
    const turns = data?.runs.filter((r) => r.outcome !== "transcribed") ?? [];
    const handoffRate = turns.length ? Math.round((turns.filter((r) => r.outcome !== "replied").length / turns.length) * 100) : null;
    const missing = c ? [!c.anthropic && "ANTHROPIC_API_KEY", !c.groq && "GROQ_API_KEY", !c.webhook && "META_APP_SECRET / META_VERIFY_TOKEN", !c.facebook && "META_PAGE_ACCESS_TOKEN", !c.meta_app_id && "META_APP_ID"].filter(Boolean) : [];

    return (
        <div>
            <PageHeader
                title={t("Support bot")}
                subtitle={t("Answers customers on Messenger, Instagram and WhatsApp in Darija and French, and hands them to an agent when it can't help.")}
                extra={<Button type="primary" onClick={save}>{t("Save")}</Button>}
            />
            {missing.length > 0 && (
                <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={t("Not fully connected. Missing on the server: {names}", { names: missing.join(", ") })} />
            )}

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} md={8}>
                    <Card styles={{ body: { padding: 16 } }} style={{ height: "100%" }} loading={loading}>
                        <Text type="secondary">{t("AI spend this month")}</Text>
                        <div style={{ marginTop: 8 }}><TargetBar value={data?.spent ?? 0} target={budget} format={usd} /></div>
                        <Text type="secondary" style={{ fontSize: 12 }}>{t("Owners are alerted at 80% and 100%. The bot keeps answering after that.")}</Text>
                    </Card>
                </Col>
                <Col xs={12} md={8}><Kpi loading={loading} title={t("Recent turns")} value={turns.length} sub={t("{count} replied", { count: turns.filter((r) => r.outcome === "replied").length })} /></Col>
                <Col xs={12} md={8}><Kpi loading={loading} title={t("Handed to agents")} value={handoffRate === null ? "—" : `${handoffRate}%`} hint={t("Share of the recent turns the bot gave to a person.")} /></Col>
            </Row>

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={10}>
                    <Card title={<Space><RobotOutlined />{t("Settings")}</Space>} loading={loading}>
                        <Form form={form} layout="vertical">
                            <Form.Item name="enabled" label={t("Bot answers customers")} valuePropName="checked"><Switch /></Form.Item>
                            <Form.Item name="channels" label={t("Channels it answers")}>
                                <Checkbox.Group options={[{ value: "facebook", label: "Messenger" }, { value: "instagram", label: "Instagram" }, { value: "whatsapp", label: "WhatsApp" }]} />
                            </Form.Item>
                            <Form.Item name="monthly_budget_usd" label={t("Monthly AI budget (USD)")}><InputNumber min={0} max={10000} step={5} style={{ width: "100%" }} /></Form.Item>
                            <Form.Item name="model" label={t("Model")}><Select options={MODELS} /></Form.Item>
                            <Form.Item name="escalation_model" label={t("Model for a second try after the bot didn't understand")}><Select options={MODELS} /></Form.Item>
                            <Form.Item name="handoff_message" label={t("Message sent when the bot hands over to an agent")} rules={[{ required: true }]}><Input.TextArea rows={2} maxLength={1000} /></Form.Item>
                            <Form.Item
                                name="knowledge"
                                label={t("What else the bot should know")}
                                extra={t("New policies, a promo, opening hours, a size chart... The bot trusts this text like its own rules. Products, prices and stock come from the catalog automatically.")}
                            >
                                <Input.TextArea rows={8} maxLength={20000} showCount />
                            </Form.Item>
                        </Form>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            {t("Prompt version {version}", { version: data?.prompt_version ?? "—" })}
                            {c?.langfuse ? <> · <a href={c.langfuse_url} target="_blank" rel="noreferrer">Langfuse</a></> : ` · ${t("Langfuse not connected")}`}
                        </Text>
                    </Card>
                </Col>

                <Col xs={24} xl={14}>
                    <Card title={t("Cost per day (30 days)")} loading={loading}>
                        <BarChart format={usd} data={(data?.days ?? []).map((d) => ({ label: d.day.slice(5), value: d.cost, tooltip: `${d.day}: ${usd(d.cost)} · ${t("{count} turns", { count: d.turns })} · ${t("{count} handed over", { count: d.handoffs })}` }))} emptyText={t("No activity yet.")} />
                    </Card>
                    <Card title={t("Waiting for an agent ({count})", { count: data?.waiting.length ?? 0 })} style={{ marginTop: 16 }} loading={loading}>
                        <Table
                            size="small"
                            rowKey="id"
                            dataSource={data?.waiting ?? []}
                            pagination={{ pageSize: 8, hideOnSinglePage: true }}
                            scroll={{ x: "max-content" }}
                            locale={{ emptyText: t("Nobody is waiting.") }}
                            columns={[
                                { title: t("Customer"), key: "name", render: (_, r) => <Link href={`/admin/customers/${r.id}`}>{r.full_name || r.phone || t("(no name)")}</Link> },
                                { title: t("Channel"), dataIndex: "channel", render: (v: string) => <ChannelTag channel={v} /> },
                                { title: t("Why"), dataIndex: "bot_handoff_reason", render: (v: string | null) => v ?? "—" },
                                { title: t("Since"), dataIndex: "bot_handoff_at", render: (v: string | null) => (v ? formatDate(v, locale, true) : "—") },
                                { title: t("Handled by"), dataIndex: "assigned_to_email", render: (v: string | null) => v ?? "—" },
                            ]}
                        />
                    </Card>
                </Col>
            </Row>

            <Card title={t("Recent bot turns")} style={{ marginTop: 16 }}>
                <Table
                    size="small"
                    rowKey="id"
                    loading={loading}
                    dataSource={data?.runs ?? []}
                    pagination={{ pageSize: 20, hideOnSinglePage: true }}
                    scroll={{ x: "max-content" }}
                    expandable={{
                        rowExpandable: (r) => r.tool_calls.length > 0 || Boolean(r.error),
                        expandedRowRender: (r) => (
                            <div style={{ maxWidth: 900 }}>
                                {r.error && <Alert type="error" showIcon title={r.error} style={{ marginBottom: 8 }} />}
                                {r.tool_calls.map((call, n) => (
                                    <div key={n} style={{ marginBottom: 8 }}>
                                        <Tag color="blue">{call.name}</Tag>
                                        <Paragraph code style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: "4px 0" }}>{JSON.stringify(call.input)}</Paragraph>
                                        <Paragraph style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#fafafa", padding: 6, borderRadius: 4, maxHeight: 200, overflow: "auto" }}>{JSON.stringify(call.output, null, 1)}</Paragraph>
                                    </div>
                                ))}
                            </div>
                        ),
                    }}
                    columns={[
                        { title: t("When"), dataIndex: "created_at", render: (v: string) => formatDate(v, locale, true) },
                        { title: t("Customer"), key: "customer", render: (_, r) => (r.customer_id ? <Link href={`/admin/customers/${r.customer_id}`}>{r.customer?.full_name || r.customer?.phone || t("(no name)")}</Link> : "—") },
                        { title: t("Result"), dataIndex: "outcome", render: (v: Run["outcome"], r) => <Tag color={OUTCOME_COLORS[v]}>{t(OUTCOME_LABELS[v])}{r.handoff_reason ? ` · ${r.handoff_reason}` : ""}</Tag> },
                        { title: t("Reply"), dataIndex: "reply", render: (v: string | null) => <div style={{ maxWidth: 360, whiteSpace: "pre-wrap", fontSize: 12 }}>{v ?? "—"}</div> },
                        { title: t("Tools"), key: "tools", render: (_, r) => r.tool_calls.map((call) => call.name).join(", ") || "—" },
                        { title: t("Cost"), dataIndex: "cost_usd", render: (v: number) => usd(v) },
                        {
                            title: t("Tokens"),
                            key: "tokens",
                            render: (_, r) => (r.outcome === "transcribed" ? `${r.audio_seconds}s` : <Text type="secondary" style={{ fontSize: 12 }}>{r.input_tokens + r.cache_read_tokens} → {r.output_tokens}{r.cache_read_tokens ? ` (${t("{count} cached", { count: r.cache_read_tokens })})` : ""}</Text>),
                        },
                        { title: t("Time"), dataIndex: "latency_ms", render: (v: number) => (v ? `${(v / 1000).toFixed(1)}s` : "—") },
                        { title: t("Model"), dataIndex: "model", render: (v: string, r) => <Text type="secondary" style={{ fontSize: 12 }}>{v} · {r.prompt_version}</Text> },
                        {
                            title: "",
                            key: "trace",
                            // shortcut: Langfuse redirects /trace/<id> to the project's trace page; if it stops, store the project id.
                            render: (_, r) => (r.trace_id && c?.langfuse ? <a href={`${c.langfuse_url}/trace/${r.trace_id}`} target="_blank" rel="noreferrer">{t("Trace")}</a> : null),
                        },
                    ]}
                />
            </Card>
        </div>
    );
}
