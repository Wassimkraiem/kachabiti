"use client";

import { useState } from "react";
import { Button, Empty, Input, Modal, Popconfirm, Popover, Space, Spin, Typography } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { useAdminRole } from "@/lib/admin-role-context";
import { api, useApi } from "./erp-client";

const { Text } = Typography;

interface Reply { id: string; title: string; body: string; position: number }

const matches = (r: Reply, q: string) => !q || `${r.title}\n${r.body}`.toLowerCase().includes(q.toLowerCase());

/** Next to the message box: the team's saved replies. Picking one puts it in the box, to edit or send. */
export function SavedReplies({ onPick }: { onPick: (text: string) => void }) {
    const { t } = useAdminT();
    const [open, setOpen] = useState(false);
    const [managing, setManaging] = useState(false);
    const [q, setQ] = useState("");
    const { data, loading, error, reload } = useApi<Reply[]>(open || managing ? "/api/crm/replies" : null);
    const list = (data ?? []).filter((r) => matches(r, q.trim()));

    const content = (
        <div style={{ width: "min(360px, 80vw)" }}>
            <Input.Search allowClear autoFocus placeholder={t("Search")} aria-label={t("Search")} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
            {error && <Text type="danger">{t(error)}</Text>}
            {loading && !data && <Spin />}
            {data && !list.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("No saved reply.")} />}
            <div style={{ maxHeight: 320, overflowY: "auto", overflowX: "hidden", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 2 }}>
                {list.map((r) => (
                    <button key={r.id} type="button" className="msgr-reply" onClick={() => { onPick(r.body); setOpen(false); }}>
                        <span dir="auto" style={{ fontWeight: 600 }}>{r.title}</span>
                        <span dir="auto" className="msgr-ellipsis" style={{ color: "#6b6b6b", fontSize: 12 }}>{r.body}</span>
                    </button>
                ))}
            </div>
            <Button type="link" style={{ paddingInline: 0, marginTop: 6 }} onClick={() => { setOpen(false); setManaging(true); }}>{t("Manage saved replies")}</Button>
        </div>
    );
    return (
        <>
            <Popover open={open} onOpenChange={setOpen} trigger="click" placement="topLeft" content={content} title={t("Saved replies")}>
                <Button type="text" shape="circle" icon={<ThunderboltOutlined />} aria-label={t("Saved replies")} title={t("Saved replies")} />
            </Popover>
            {managing && <ManageReplies replies={data ?? []} loading={loading} onChange={reload} onClose={() => setManaging(false)} />}
        </>
    );
}

function ManageReplies({ replies, loading, onChange, onClose }: { replies: Reply[]; loading: boolean; onChange: () => Promise<void>; onClose: () => void }) {
    const { t } = useAdminT();
    const { isAdmin, can } = useAdminRole();
    const [editing, setEditing] = useState<Reply | "new" | null>(null);
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [busy, setBusy] = useState(false);
    const edit = (r: Reply | "new") => {
        setEditing(r);
        setTitle(r === "new" ? "" : r.title);
        setBody(r === "new" ? "" : r.body);
    };
    const run = async (work: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await work();
            await onChange();
            setEditing(null);
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setBusy(false);
        }
    };
    const save = () => run(() => api("/api/crm/replies", editing === "new"
        ? { method: "POST", body: { title, body } }
        : { method: "PUT", body: { id: (editing as Reply).id, title, body } }));

    return (
        <Modal open title={t("Saved replies")} onCancel={onClose} footer={null} width={640}>
            {editing ? (
                <Space orientation="vertical" style={{ width: "100%" }}>
                    <Input value={title} maxLength={80} placeholder={t("Title (to find it)")} aria-label={t("Title (to find it)")} dir="auto" onChange={(e) => setTitle(e.target.value)} />
                    <Input.TextArea value={body} maxLength={2000} autoSize={{ minRows: 3, maxRows: 10 }} placeholder={t("Message")} aria-label={t("Message")} dir="auto" onChange={(e) => setBody(e.target.value)} />
                    <Space>
                        <Button type="primary" loading={busy} disabled={!title.trim() || !body.trim()} onClick={save}>{t("Save")}</Button>
                        <Button disabled={busy} onClick={() => setEditing(null)}>{t("Cancel")}</Button>
                    </Space>
                </Space>
            ) : (
                <>
                    <Button icon={<PlusOutlined />} onClick={() => edit("new")} style={{ marginBottom: 12 }}>{t("Add a saved reply")}</Button>
                    {loading && !replies.length && <Spin />}
                    <div style={{ maxHeight: "60vh", overflowY: "auto", display: "grid", gap: 8 }}>
                        {replies.map((r) => (
                            <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: 8, border: "1px solid #ececec", borderRadius: 8 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div dir="auto" style={{ fontWeight: 600 }}>{r.title}</div>
                                    <div dir="auto" style={{ whiteSpace: "pre-wrap", color: "#555", fontSize: 13 }}>{r.body}</div>
                                </div>
                                <Button type="text" icon={<EditOutlined />} aria-label={t("Edit")} title={t("Edit")} onClick={() => edit(r)} />
                                {(isAdmin || can("delete")) && (
                                    <Popconfirm title={t("Delete this saved reply?")} okText={t("Delete")} cancelText={t("Cancel")} onConfirm={() => run(() => api(`/api/crm/replies?id=${r.id}`, { method: "DELETE" }))}>
                                        <Button type="text" danger icon={<DeleteOutlined />} aria-label={t("Delete")} title={t("Delete")} disabled={busy} />
                                    </Popconfirm>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}
        </Modal>
    );
}
