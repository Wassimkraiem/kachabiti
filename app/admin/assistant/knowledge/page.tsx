"use client";

import { useMemo, useState } from "react";
import { parse } from "csv-parse/browser/esm/sync";
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Radio, Segmented, Select, Space, Switch, Table, Tag, Typography, Upload } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CloudSyncOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { PageHeader } from "@/components/admin/erp/ui";
import { api, formatDate, useApi } from "@/components/admin/erp/erp-client";

const { Text, Paragraph } = Typography;

type Kind = "faq" | "doc";

interface Entry {
    id: string;
    kind: Kind;
    title: string;
    content: string;
    language: string | null;
    active: boolean;
    updated_at: string;
    chunks: number;
    embedded: number;
}

interface Hit {
    chunk_id: string;
    title: string;
    kind: Kind;
    content: string;
    score: number;
    found_by: ("words" | "meaning")[];
}

interface ImportEntry {
    kind: Kind;
    title: string;
    content: string;
    language?: string | null;
}

const LANGUAGES = [
    { value: "darija", label: "Darija" },
    { value: "ar", label: "العربية" },
    { value: "fr", label: "Français" },
    { value: "en", label: "English" },
];

/**
 * Admin → Support bot → Knowledge (owners and admins): the questions and answers and documents the
 * bot searches for each customer message. Only the few that match go into its prompt, so the
 * knowledge can grow without each reply costing more.
 */
export default function BotKnowledgePage() {
    const { t, locale } = useAdminT();
    const { data, loading, reload } = useApi<{ entries: Entry[]; embeddings: { configured: boolean; model: string } }>("/api/admin/assistant/knowledge");
    const [kind, setKind] = useState<"all" | Kind>("all");
    const [filter, setFilter] = useState("");
    const [editing, setEditing] = useState<Partial<Entry> | null>(null);
    const [saving, setSaving] = useState(false);
    const [importing, setImporting] = useState(false);
    const [embedding, setEmbedding] = useState(false);
    const [question, setQuestion] = useState("");
    const [hits, setHits] = useState<Hit[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [form] = Form.useForm();

    const entries = useMemo(() => {
        const term = filter.trim().toLowerCase();
        return (data?.entries ?? []).filter(
            (e) => (kind === "all" || e.kind === kind) && (!term || e.title.toLowerCase().includes(term) || e.content.toLowerCase().includes(term)),
        );
    }, [data, kind, filter]);
    const missing = (data?.entries ?? []).reduce((n, e) => n + e.chunks - e.embedded, 0);

    const open = (entry: Partial<Entry>) => {
        setEditing(entry);
        form.setFieldsValue({ kind: "faq", active: true, language: null, ...entry });
    };

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            const result = await api<{ warning: string | null }>("/api/admin/assistant/knowledge", { method: "POST", body: { ...values, id: editing?.id ?? null } });
            if (result.warning) message.warning(t("Saved, but searchable by words only for now: {error}", { error: result.warning }));
            else message.success(t("Saved"));
            setEditing(null);
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setSaving(false);
        }
    };

    const toggle = async (entry: Entry, active: boolean) => {
        try {
            await api("/api/admin/assistant/knowledge", { method: "POST", body: { id: entry.id, kind: entry.kind, title: entry.title, content: entry.content, language: entry.language, active } });
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const remove = async (ids: string[]) => {
        try {
            await api(`/api/admin/assistant/knowledge?ids=${ids.join(",")}`, { method: "DELETE" });
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    /** A CSV of questions (columns question, answer and optionally language), or text files as documents. */
    const importFiles = async (files: File[]) => {
        setImporting(true);
        try {
            const entries: ImportEntry[] = [];
            for (const file of files) {
                const text = await file.text();
                if (/\.csv$/i.test(file.name)) {
                    const rows = parse(text, { columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
                    for (const row of rows) {
                        const title = row.question ?? row.q ?? "";
                        const content = row.answer ?? row.a ?? "";
                        if (title && content) entries.push({ kind: "faq", title, content, language: LANGUAGES.some((l) => l.value === row.language) ? row.language : null });
                    }
                } else if (text.trim()) {
                    entries.push({ kind: "doc", title: file.name.replace(/\.[^.]+$/, ""), content: text });
                }
            }
            if (!entries.length) {
                message.warning(t("Nothing to import. A CSV needs the columns question and answer."));
                return;
            }
            let saved = 0;
            for (let i = 0; i < entries.length; i += 200) {
                const result = await api<{ saved: number; warnings: string[] }>("/api/admin/assistant/knowledge/import", { method: "POST", body: { entries: entries.slice(i, i + 200) } });
                saved += result.saved;
                if (result.warnings.length) message.warning(t("Saved, but searchable by words only for now: {error}", { error: result.warnings[0] }));
            }
            message.success(t("{count} entries imported", { count: saved }));
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setImporting(false);
        }
    };

    const embedMissing = async () => {
        setEmbedding(true);
        try {
            const result = await api<{ embedded: number }>("/api/admin/assistant/knowledge/embed", { method: "POST" });
            message.success(t("{count} parts can now be found by meaning", { count: result.embedded }));
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setEmbedding(false);
        }
    };

    const test = async () => {
        if (!question.trim()) return;
        setSearching(true);
        try {
            setHits(await api<Hit[]>(`/api/admin/assistant/knowledge/search?q=${encodeURIComponent(question)}`));
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setSearching(false);
        }
    };

    const columns: ColumnsType<Entry> = [
        {
            title: t("Question or title"),
            key: "title",
            render: (_, e) => (
                <div style={{ maxWidth: 420 }}>
                    <Space size={4} wrap>
                        <Tag color={e.kind === "faq" ? "blue" : "purple"}>{e.kind === "faq" ? t("Q&A") : t("Document")}</Tag>
                        {e.language && <Tag>{LANGUAGES.find((l) => l.value === e.language)?.label}</Tag>}
                    </Space>
                    <div style={{ fontWeight: 500, marginTop: 4 }}>{e.title}</div>
                    <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ margin: 0, fontSize: 12 }}>{e.content}</Paragraph>
                </div>
            ),
        },
        {
            title: t("Searchable"),
            key: "chunks",
            render: (_, e) => (
                <Text type="secondary" style={{ fontSize: 12 }}>
                    {t("{count} part(s)", { count: e.chunks })}
                    {data?.embeddings.configured && e.embedded < e.chunks ? ` · ${t("words only")}` : ""}
                </Text>
            ),
        },
        { title: t("Updated"), dataIndex: "updated_at", key: "updated_at", render: (v: string) => formatDate(v, locale, true) },
        { title: t("Active"), key: "active", render: (_, e) => <Switch size="small" checked={e.active} onChange={(v) => toggle(e, v)} /> },
        {
            title: t("Action"),
            key: "action",
            render: (_, e) => (
                <Space size={0}>
                    <Button type="link" size="small" icon={<EditOutlined />} onClick={() => open(e)} aria-label={t("Edit")} />
                    <Popconfirm title={t("Delete this entry?")} okText={t("Delete")} cancelText={t("Cancel")} onConfirm={() => remove([e.id])}>
                        <Button type="link" size="small" danger icon={<DeleteOutlined />} aria-label={t("Delete")} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div>
            <PageHeader
                title={t("Bot knowledge")}
                subtitle={t("Questions with your answers, and documents. For each customer message the bot only reads the few that match, so you can add as many as you need.")}
                crumbs={[{ title: t("Support bot"), href: "/admin/assistant" }]}
                extra={
                    <>
                        <Button icon={<PlusOutlined />} type="primary" onClick={() => open({ kind: "faq" })}>{t("Add a question")}</Button>
                        <Button icon={<PlusOutlined />} onClick={() => open({ kind: "doc" })}>{t("Add a document")}</Button>
                        <Upload accept=".csv,.txt,.md" multiple showUploadList={false} beforeUpload={(_, list) => { if (_ === list[0]) void importFiles(list); return false; }}>
                            <Button icon={<UploadOutlined />} loading={importing}>{t("Import")}</Button>
                        </Upload>
                    </>
                }
            />

            {data && !data.embeddings.configured && (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    title={t("The bot finds knowledge by its words only")}
                    description={t("Add VOYAGE_API_KEY (voyageai.com) to the server environment so it also finds it by meaning: \"ki twasslou\" will then find your delivery times.")}
                />
            )}
            {data?.embeddings.configured && missing > 0 && (
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    title={t("{count} part(s) can only be found by their words", { count: missing })}
                    action={<Button size="small" icon={<CloudSyncOutlined />} loading={embedding} onClick={embedMissing}>{t("Fix now")}</Button>}
                />
            )}

            <Card title={t("Try it: what would the bot find?")} style={{ marginBottom: 16 }}>
                <Space.Compact style={{ width: "100%", maxWidth: 640 }}>
                    <Input placeholder={t("Type a customer message, e.g. ki twasslou l sfax?")} value={question} onChange={(e) => setQuestion(e.target.value)} onPressEnter={test} />
                    <Button icon={<SearchOutlined />} loading={searching} onClick={test}>{t("Search")}</Button>
                </Space.Compact>
                {hits && (
                    <div style={{ marginTop: 12 }}>
                        {hits.length === 0 ? (
                            <Text type="secondary">{t("Nothing matches: the bot would hand this customer to an agent if it can't answer otherwise.")}</Text>
                        ) : (
                            hits.map((hit, i) => (
                                <div key={hit.chunk_id} style={{ padding: "8px 0", borderTop: i ? "1px solid #f0f0f0" : undefined }}>
                                    <Space size={4} wrap>
                                        <Text strong>{i + 1}. {hit.title}</Text>
                                        {hit.found_by.map((f) => <Tag key={f} color={f === "meaning" ? "purple" : "blue"}>{f === "meaning" ? t("by meaning") : t("by words")}</Tag>)}
                                    </Space>
                                    <Paragraph type="secondary" ellipsis={{ rows: 3, expandable: true }} style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{hit.content}</Paragraph>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </Card>

            <Card>
                <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                    <div className="admin-filters" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <Segmented
                            value={kind}
                            onChange={(v) => setKind(v as typeof kind)}
                            options={[
                                { value: "all", label: `${t("All")} (${data?.entries.length ?? 0})` },
                                { value: "faq", label: t("Q&A") },
                                { value: "doc", label: t("Documents") },
                            ]}
                        />
                        <Input allowClear prefix={<SearchOutlined />} placeholder={t("Filter questions and answers")} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 360 }} />
                    </div>
                    <Table rowKey="id" loading={loading} dataSource={entries} columns={columns} pagination={{ pageSize: 25, showSizeChanger: false }} locale={{ emptyText: t("No knowledge yet. Add a question, or import a CSV with the columns question and answer.") }} />
                </Space>
            </Card>

            <Modal
                open={!!editing}
                title={editing?.id ? t("Edit") : editing?.kind === "doc" ? t("Add a document") : t("Add a question")}
                okText={t("Save")}
                cancelText={t("Cancel")}
                confirmLoading={saving}
                onOk={save}
                onCancel={() => setEditing(null)}
                width={720}
                destroyOnHidden
            >
                <Form form={form} layout="vertical">
                    <Form.Item name="kind" label={t("Type")}>
                        <Radio.Group options={[{ value: "faq", label: t("Q&A") }, { value: "doc", label: t("Document") }]} optionType="button" />
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate={(a, b) => a.kind !== b.kind}>
                        {({ getFieldValue }) => (
                            <>
                                <Form.Item name="title" label={getFieldValue("kind") === "doc" ? t("Title") : t("Question (as customers ask it)")} rules={[{ required: true, whitespace: true, message: t("Required") }]}>
                                    <Input maxLength={500} />
                                </Form.Item>
                                <Form.Item name="content" label={getFieldValue("kind") === "doc" ? t("Text") : t("Our answer")} rules={[{ required: true, whitespace: true, message: t("Required") }]}>
                                    <Input.TextArea autoSize={{ minRows: 4, maxRows: 18 }} maxLength={100_000} />
                                </Form.Item>
                            </>
                        )}
                    </Form.Item>
                    <Space wrap size="large">
                        <Form.Item name="language" label={t("Language")}>
                            <Select allowClear placeholder={t("Any")} options={LANGUAGES} style={{ width: 160 }} />
                        </Form.Item>
                        <Form.Item name="active" label={t("Active")} valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </Space>
                </Form>
            </Modal>
        </div>
    );
}
