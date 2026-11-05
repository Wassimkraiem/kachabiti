"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Alert, Avatar, Button, DatePicker, Image, Input, Modal, Popconfirm, Popover, Select, Tooltip, Typography } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, ClockCircleOutlined, DeleteOutlined, EllipsisOutlined, MessageOutlined, PaperClipOutlined, PlusOutlined, UserOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { useAdminRole } from "@/lib/admin-role-context";
import { AgentSelect, PageHeader, useTeam } from "@/components/admin/erp/ui";
import { api, day, useApi } from "@/components/admin/erp/erp-client";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABELS, TICKET_STATUSES, TICKET_STATUS_LABELS, type TicketPriority, type TicketStatus } from "@/lib/erp/constants";

const { Text } = Typography;

interface Ticket {
    id: string;
    ticket_number: number;
    position: number;
    title: string;
    description: string | null;
    status: TicketStatus;
    priority: TicketPriority;
    due_date: string | null;
    assigned_to: string | null;
    assigned_to_email: string | null;
    created_by: string | null;
    created_by_email: string | null;
    comment_count: number;
}

interface Comment {
    id: string;
    body: string;
    image_url: string | null;
    author_id: string | null;
    author_email: string | null;
}

type TicketChange = Partial<Pick<Ticket, "title" | "description" | "status" | "priority" | "due_date" | "assigned_to" | "position">>;

const INK = "#172b4d";
const SUBTLE = "#626f86";
const LOZENGES: Record<TicketStatus, { background: string; color: string }> = {
    todo: { background: "#dcdfe4", color: "#44546f" },
    in_progress: { background: "#cce0ff", color: "#0055cc" },
    done: { background: "#baf3db", color: "#216e4e" },
};
const AVATAR_COLORS = ["#0c66e4", "#6e5dc6", "#1f845a", "#c9372c", "#a54800", "#206a83", "#ae2e24", "#5e4db2"];
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE = 5 * 1024 * 1024;

const nameOf = (email: string | null) => email?.split("@")[0] ?? "";
const avatarColor = (email: string) => AVATAR_COLORS[[...email].reduce((sum, c) => sum + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

function Person({ email, size = 24 }: { email: string | null; size?: number }) {
    const { t } = useAdminT();
    return (
        <Tooltip title={email ? nameOf(email) : t("Unassigned")}>
            <Avatar
                size={size}
                icon={email ? undefined : <UserOutlined />}
                alt={email ? nameOf(email) : t("Unassigned")}
                style={{ background: email ? avatarColor(email) : "#dcdfe4", color: email ? "#fff" : SUBTLE, flex: "none", fontSize: size * 0.45 }}
            >
                {email?.[0].toUpperCase()}
            </Avatar>
        </Tooltip>
    );
}

function PriorityIcon({ priority }: { priority: TicketPriority }) {
    const { t } = useAdminT();
    if (priority === "normal") return null;
    const label = t(TICKET_PRIORITY_LABELS[priority]);
    return priority === "high"
        ? <ArrowUpOutlined aria-label={label} style={{ color: "#c9372c", fontSize: 12 }} />
        : <ArrowDownOutlined aria-label={label} style={{ color: "#0c66e4", fontSize: 12 }} />;
}

function Lozenge({ status }: { status: TicketStatus }) {
    const { t } = useAdminT();
    return <span style={{ ...LOZENGES[status], borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>{t(TICKET_STATUS_LABELS[status])}</span>;
}

/** "+ Create" at the bottom of a column: Enter adds the task and stays open for the next one. */
function QuickCreate({ open, onOpen, onClose, onCreate }: { open: boolean; onOpen: () => void; onClose: () => void; onCreate: (title: string) => void }) {
    const { t } = useAdminT();
    const [title, setTitle] = useState("");
    if (!open) return <Button type="text" block icon={<PlusOutlined />} onClick={onOpen} style={{ textAlign: "start", color: SUBTLE, justifyContent: "flex-start" }}>{t("Create")}</Button>;
    const submit = () => {
        if (title.trim()) onCreate(title.trim());
        setTitle("");
    };
    return (
        <Input.TextArea
            autoFocus
            autoSize={{ minRows: 2 }}
            maxLength={200}
            value={title}
            placeholder={t("What needs to be done?")}
            aria-label={t("What needs to be done?")}
            onChange={(e) => setTitle(e.target.value)}
            onPressEnter={(e) => { e.preventDefault(); submit(); }}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
            onBlur={() => { if (!title.trim()) onClose(); }}
            style={{ borderRadius: 8 }}
        />
    );
}

function Comments({ ticketId, canDeleteAny, onChange }: { ticketId: string; canDeleteAny: boolean; onChange: () => void }) {
    const { t } = useAdminT();
    const { id: me, email } = useAdminRole();
    const { data, reload } = useApi<Comment[]>(`/api/admin/tickets/comments?ticket_id=${ticketId}`);
    const [text, setText] = useState("");
    const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
    const [focused, setFocused] = useState(false);
    const [sending, setSending] = useState(false);
    const input = useRef<HTMLInputElement>(null);

    const add = (picked: File[]) => {
        const good = picked.filter((file) => IMAGE_TYPES.includes(file.type) && file.size <= MAX_IMAGE);
        if (good.length < picked.length) message.error(t("Images only, up to 5 MB each."));
        setFiles((current) => [...current, ...good.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    };
    const drop = (url: string) => {
        URL.revokeObjectURL(url);
        setFiles((current) => current.filter((item) => item.url !== url));
    };

    const send = async () => {
        setSending(true);
        try {
            // The text goes with the first image; a comment holds one image.
            for (let i = 0; i < Math.max(files.length, 1); i++) {
                const body = new FormData();
                body.append("ticket_id", ticketId);
                body.append("body", i === 0 ? text : "");
                if (files[i]) body.append("file", files[i].file);
                await api("/api/admin/tickets/comments", { method: "POST", body });
            }
            setText("");
            files.forEach((item) => URL.revokeObjectURL(item.url));
            setFiles([]);
            setFocused(false);
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setSending(false);
            reload();
            onChange();
        }
    };

    const remove = async (id: string) => {
        try {
            await api(`/api/admin/tickets/comments?id=${id}`, { method: "DELETE" });
            reload();
            onChange();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const ready = !!text.trim() || files.length > 0;
    return (
        <section aria-label={t("Comments")} style={{ marginTop: 24 }}>
            <Text strong style={{ color: INK }}>{t("Comments")}</Text>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <Person email={email} size={32} />
                <div
                    style={{ flex: 1, minWidth: 0 }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); add([...e.dataTransfer.files]); }}
                >
                    <Input.TextArea
                        autoSize={{ minRows: focused || ready ? 3 : 1 }}
                        maxLength={2000}
                        value={text}
                        placeholder={t("Add a comment...")}
                        aria-label={t("Add a comment...")}
                        onChange={(e) => setText(e.target.value)}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        onPaste={(e) => {
                            const pasted = [...e.clipboardData.files];
                            if (pasted.length) { e.preventDefault(); add(pasted); }
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && ready) send(); }}
                        style={{ borderRadius: 8 }}
                    />
                    {files.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                            {files.map(({ url, file }) => (
                                <div key={url} style={{ position: "relative" }}>
                                    {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
                                    <img src={url} alt={file.name} style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 8, display: "block" }} />
                                    <Button size="small" shape="circle" icon={<DeleteOutlined />} aria-label={t("Remove image")} onClick={() => drop(url)} style={{ position: "absolute", top: 4, insetInlineEnd: 4 }} />
                                </div>
                            ))}
                        </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <Button type="text" size="small" icon={<PaperClipOutlined />} onClick={() => input.current?.click()} style={{ color: SUBTLE }}>{t("Attach image")}</Button>
                        <input
                            ref={input}
                            type="file"
                            hidden
                            multiple
                            accept={IMAGE_TYPES.join(",")}
                            aria-label={t("Attach image")}
                            onChange={(e) => { add([...(e.target.files ?? [])]); e.target.value = ""; }}
                        />
                        {ready ? <Button type="primary" size="small" loading={sending} onClick={send}>{t("Save")}</Button> : <Text style={{ color: SUBTLE, fontSize: 12 }}>{t("Paste, drop or attach images")}</Text>}
                    </div>
                </div>
            </div>
            <Image.PreviewGroup>
                <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
                    {data?.map((comment) => (
                        <div key={comment.id} style={{ display: "flex", gap: 10 }}>
                            <Person email={comment.author_email} size={32} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                    <Text strong style={{ color: INK, fontSize: 13 }}>{nameOf(comment.author_email)}</Text>
                                    {(comment.author_id === me || canDeleteAny) && (
                                        <Popconfirm title={t("Delete this comment?")} onConfirm={() => remove(comment.id)} okText={t("Delete")} cancelText={t("Cancel")}>
                                            <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={t("Delete")} style={{ color: SUBTLE }} />
                                        </Popconfirm>
                                    )}
                                </div>
                                {comment.body && <div style={{ color: INK, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{comment.body}</div>}
                                {comment.image_url && <Image src={comment.image_url} alt={t("Image")} width={320} style={{ maxWidth: "100%", borderRadius: 8, marginTop: 6 }} />}
                            </div>
                        </div>
                    ))}
                </div>
            </Image.PreviewGroup>
        </section>
    );
}

/** An open ticket: title, description and comments; each change saves on its own. */
function TicketView({ ticket, canDelete, canDeleteAny, onChange, onDelete, onComment }: {
    ticket: Ticket;
    canDelete: boolean;
    canDeleteAny: boolean;
    onChange: (change: TicketChange) => void;
    onDelete: () => void;
    onComment: () => void;
}) {
    const { t } = useAdminT();
    const [title, setTitle] = useState(ticket.title);
    const [description, setDescription] = useState<string | null>(null); // non-null while editing

    const saveTitle = () => {
        const next = title.trim();
        if (next && next !== ticket.title) onChange({ title: next });
        else setTitle(ticket.title);
    };
    const saveDescription = () => {
        if (description !== null && description.trim() !== (ticket.description ?? "")) onChange({ description: description.trim() });
        setDescription(null);
    };

    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingInlineEnd: 32, marginBottom: 8 }}>
                <Text style={{ color: SUBTLE, fontSize: 13, marginInlineEnd: "auto" }}>T-{ticket.ticket_number}</Text>
                <Select
                    variant="borderless"
                    size="small"
                    aria-label={t("Status")}
                    value={ticket.status}
                    onChange={(status) => onChange({ status })}
                    popupMatchSelectWidth={false}
                    options={TICKET_STATUSES.map((value) => ({ value, label: <Lozenge status={value} /> }))}
                />
                <Popover
                    trigger="click"
                    title={t("Assigned to")}
                    content={<AgentSelect value={ticket.assigned_to} onChange={(assigned_to) => onChange({ assigned_to })} style={{ width: 240 }} />}
                >
                    <Button type="text" size="small" shape="circle" aria-label={t("Assigned to")} style={{ padding: 0 }}><Person email={ticket.assigned_to_email} /></Button>
                </Popover>
                <Popover
                    trigger="click"
                    content={
                        <div style={{ display: "grid", gap: 10, width: 220 }}>
                            <label>
                                <Text style={{ color: SUBTLE, fontSize: 12 }}>{t("Priority")}</Text>
                                <Select style={{ width: "100%" }} value={ticket.priority} onChange={(priority) => onChange({ priority })} options={TICKET_PRIORITIES.map((value) => ({ value, label: t(TICKET_PRIORITY_LABELS[value]) }))} />
                            </label>
                            <label>
                                <Text style={{ color: SUBTLE, fontSize: 12 }}>{t("Due date")}</Text>
                                <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" value={ticket.due_date ? dayjs(ticket.due_date) : null} onChange={(value) => onChange({ due_date: value ? day(value) : null })} />
                            </label>
                            {ticket.created_by_email && <Text style={{ color: SUBTLE, fontSize: 12 }}>{t("Created by {who}", { who: nameOf(ticket.created_by_email) })}</Text>}
                            {canDelete && (
                                <Popconfirm title={t("Delete this task?")} onConfirm={onDelete} okText={t("Delete")} cancelText={t("Cancel")}>
                                    <Button danger block icon={<DeleteOutlined />}>{t("Delete")}</Button>
                                </Popconfirm>
                            )}
                        </div>
                    }
                >
                    <Button type="text" size="small" icon={<EllipsisOutlined />} aria-label={t("More actions")} />
                </Popover>
            </div>

            <Input.TextArea
                variant="borderless"
                autoSize
                maxLength={200}
                aria-label={t("Title")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onPressEnter={(e) => { e.preventDefault(); e.currentTarget.blur(); }}
                style={{ fontSize: 22, fontWeight: 600, color: INK, padding: "2px 6px", marginInlineStart: -6, borderRadius: 6 }}
            />

            <div style={{ marginTop: 16 }}>
                <Text strong style={{ color: INK }}>{t("Description")}</Text>
                {description === null ? (
                    <div
                        role="button"
                        tabIndex={0}
                        className="kb-editable"
                        aria-label={t("Add a description...")}
                        onClick={() => setDescription(ticket.description ?? "")}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setDescription(ticket.description ?? ""); } }}
                        style={{ color: ticket.description ? INK : SUBTLE, padding: "6px 8px", marginInlineStart: -8, marginTop: 4, borderRadius: 6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", cursor: "text", minHeight: 32 }}
                    >
                        {ticket.description || t("Add a description...")}
                    </div>
                ) : (
                    <div style={{ marginTop: 6 }}>
                        <Input.TextArea autoFocus autoSize={{ minRows: 3 }} maxLength={5000} aria-label={t("Description")} value={description} onChange={(e) => setDescription(e.target.value)} style={{ borderRadius: 8 }} />
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <Button type="primary" size="small" onClick={saveDescription}>{t("Save")}</Button>
                            <Button type="text" size="small" onClick={() => setDescription(null)}>{t("Cancel")}</Button>
                        </div>
                    </div>
                )}
            </div>

            <Comments key={ticket.id} ticketId={ticket.id} canDeleteAny={canDeleteAny} onChange={onComment} />
        </div>
    );
}

function TicketBoard() {
    const { t } = useAdminT();
    const { id: me, isAdmin, isOwner, can } = useAdminRole();
    const team = useTeam();
    const { data, error, reload, setData } = useApi<Ticket[]>("/api/admin/tickets");
    const [openId, setOpenId] = useState<string | null>(null);
    const [creating, setCreating] = useState<TicketStatus | null>(null);
    const [person, setPerson] = useState("");
    const [search, setSearch] = useState("");
    const today = day(new Date());

    // A notification's link: /admin/tickets?id=…
    const linked = useSearchParams().get("id");
    useEffect(() => {
        if (linked) setOpenId(linked);
    }, [linked]);

    const open = data?.find((row) => row.id === openId) ?? null;
    const columns = useMemo(() => {
        const term = search.trim().toLowerCase();
        const rows = (data ?? []).filter((row) => (!person || row.assigned_to === person) && (!term || row.title.toLowerCase().includes(term)));
        return TICKET_STATUSES.map((status) => ({ status, rows: rows.filter((row) => row.status === status).sort((a, b) => a.position - b.position) }));
    }, [data, person, search]);

    const change = async (id: string, fields: TicketChange) => {
        setData((rows) => rows && rows.map((row) => (row.id === id ? { ...row, ...fields } : row)));
        try {
            const saved = await api<Ticket>("/api/admin/tickets", { method: "PUT", body: { id, ...fields } });
            setData((rows) => rows && rows.map((row) => (row.id === id ? { ...row, ...saved, comment_count: row.comment_count } : row)));
        } catch (e) {
            message.error(t((e as Error).message));
            reload();
        }
    };

    const create = async (status: TicketStatus, title: string) => {
        try {
            await api("/api/admin/tickets", { method: "POST", body: { title, status } });
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const remove = async (ids: string[]) => {
        try {
            await api(`/api/admin/tickets?ids=${ids.join(",")}`, { method: "DELETE" });
            setOpenId(null);
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const onDragEnd = ({ draggableId, source, destination }: DropResult) => {
        if (!destination || (destination.droppableId === source.droppableId && destination.index === source.index)) return;
        const status = destination.droppableId as TicketStatus;
        const others = columns.find((column) => column.status === status)!.rows.filter((row) => row.id !== draggableId);
        const before = others[destination.index - 1]?.position;
        const after = others[destination.index]?.position;
        const position = before === undefined
            ? (after === undefined ? Date.now() / 1000 : after - 1000)
            : (after === undefined ? before + 1000 : (before + after) / 2);
        change(draggableId, { status, position });
    };

    const canDeleteAny = isAdmin || can("delete");
    const mine = team.find((m) => m.user_id === me);
    const people = [...(mine ? [mine] : []), ...team.filter((m) => m.user_id !== me)];

    return (
        <div>
            <style>{`
                .kb-card { transition: background .1s, box-shadow .1s; }
                .kb-card:hover { background: #f7f8f9; }
                .kb-editable:hover { background: #f1f2f4; }
                .kb-person { opacity: .95; transition: transform .1s; }
                .kb-person:hover { transform: translateY(-2px); }
            `}</style>
            <PageHeader title={t("Team tasks")} subtitle={t("Who does what. Drag a task to move it.")} />
            {error && <Alert type="error" showIcon title={t(error)} style={{ marginBottom: 16 }} />}

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <Input.Search allowClear placeholder={t("Search tasks")} aria-label={t("Search tasks")} value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, minWidth: 0 }} role="group" aria-label={t("Show this person's tasks")}>
                    {people.map((m) => (
                        <button
                            key={m.user_id}
                            type="button"
                            className="kb-person"
                            aria-pressed={person === m.user_id}
                            aria-label={nameOf(m.email ?? "")}
                            onClick={() => setPerson((current) => (current === m.user_id ? "" : m.user_id))}
                            style={{ background: "none", border: 0, padding: 2, borderRadius: "50%", cursor: "pointer", boxShadow: person === m.user_id ? "0 0 0 2px #0c66e4" : "none" }}
                        >
                            <Person email={m.email ?? null} size={30} />
                        </button>
                    ))}
                </div>
            </div>

            <DragDropContext onDragEnd={onDragEnd}>
                <div style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(270px, 1fr)", gap: 12, alignItems: "start", overflowX: "auto", paddingBottom: 8 }}>
                    {columns.map(({ status, rows }) => (
                        <section key={status} aria-label={t(TICKET_STATUS_LABELS[status])} style={{ background: "#f1f2f4", borderRadius: 12, padding: "12px 8px 8px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "0 8px", marginBottom: 10, minHeight: 24 }}>
                                <Text style={{ color: SUBTLE, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>{t(TICKET_STATUS_LABELS[status])} {rows.length}</Text>
                                {status === "done" && isOwner && rows.length > 0 && (
                                    <Popconfirm title={t("Delete {count} done task(s)? You can restore them from Deleted items.", { count: rows.length })} onConfirm={() => remove(rows.map((row) => row.id))} okText={t("Delete")} cancelText={t("Cancel")}>
                                        <Tooltip title={t("Delete done tasks")}>
                                            <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={t("Delete done tasks")} style={{ color: SUBTLE }} />
                                        </Tooltip>
                                    </Popconfirm>
                                )}
                            </div>
                            <Droppable droppableId={status}>
                                {(drop, dropState) => (
                                    <div ref={drop.innerRef} {...drop.droppableProps} style={{ minHeight: 48, borderRadius: 8, background: dropState.isDraggingOver ? "#e9f2ff" : "transparent", transition: "background .15s" }}>
                                        {rows.map((ticket, index) => {
                                            const late = ticket.status !== "done" && !!ticket.due_date && ticket.due_date < today;
                                            return (
                                                <Draggable key={ticket.id} draggableId={ticket.id} index={index}>
                                                    {(drag, dragState) => (
                                                        <div
                                                            ref={drag.innerRef}
                                                            {...drag.draggableProps}
                                                            {...drag.dragHandleProps}
                                                            role="button"
                                                            aria-label={ticket.title}
                                                            onClick={() => setOpenId(ticket.id)}
                                                            onKeyDown={(e) => { if (e.key === "Enter") setOpenId(ticket.id); }}
                                                            style={{ ...drag.draggableProps.style, paddingBottom: 8, outlineOffset: -2 }}
                                                        >
                                                            <div
                                                                className="kb-card"
                                                                style={{
                                                                    background: "#fff",
                                                                    borderRadius: 8,
                                                                    padding: "10px 12px",
                                                                    cursor: "pointer",
                                                                    boxShadow: dragState.isDragging ? "0 8px 16px rgba(9,30,66,.25)" : "0 1px 1px rgba(9,30,66,.2)",
                                                                    transform: dragState.isDragging && !dragState.isDropAnimating ? "rotate(2deg)" : undefined,
                                                                }}
                                                            >
                                                                <div style={{ color: INK, fontSize: 14, lineHeight: "20px", overflowWrap: "anywhere" }}>{ticket.title}</div>
                                                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, minHeight: 24 }}>
                                                                    <Text style={{ color: SUBTLE, fontSize: 12 }}>T-{ticket.ticket_number}</Text>
                                                                    <PriorityIcon priority={ticket.priority} />
                                                                    {late && <Tooltip title={t("Overdue")}><ClockCircleOutlined aria-label={t("Overdue")} style={{ color: "#c9372c", fontSize: 12 }} /></Tooltip>}
                                                                    {ticket.comment_count > 0 && <Text style={{ color: SUBTLE, fontSize: 12 }}><MessageOutlined aria-label={t("Comments")} /> {ticket.comment_count}</Text>}
                                                                    <span style={{ marginInlineStart: "auto" }}><Person email={ticket.assigned_to_email} /></span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </Draggable>
                                            );
                                        })}
                                        {drop.placeholder}
                                    </div>
                                )}
                            </Droppable>
                            <QuickCreate open={creating === status} onOpen={() => setCreating(status)} onClose={() => setCreating(null)} onCreate={(title) => create(status, title)} />
                        </section>
                    ))}
                </div>
            </DragDropContext>

            <Modal open={!!open} onCancel={() => setOpenId(null)} footer={null} width={720} destroyOnHidden title={null} styles={{ body: { maxHeight: "80vh", overflowY: "auto" } }}>
                {open && (
                    <TicketView
                        key={open.id}
                        ticket={open}
                        canDelete={open.created_by === me || canDeleteAny}
                        canDeleteAny={canDeleteAny}
                        onChange={(fields) => change(open.id, fields)}
                        onDelete={() => remove([open.id])}
                        onComment={reload}
                    />
                )}
            </Modal>
        </div>
    );
}

/** Admin → Team tasks: the team's board, by status. The Suspense boundary is for useSearchParams. */
export default function TicketsPage() {
    return <Suspense><TicketBoard /></Suspense>;
}
