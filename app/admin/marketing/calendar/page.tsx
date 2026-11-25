"use client";

import { useState } from "react";
import { Alert, Button, Calendar, Card, Checkbox, DatePicker, Empty, Form, Grid, Input, Modal, Popconfirm, Space, Tag, Typography, Upload } from "antd";
import { DeleteOutlined, EditOutlined, FacebookFilled, InstagramOutlined, PlusOutlined, RedoOutlined, UploadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { message } from "@/components/admin/antd-app";
import { msg, useAdminT } from "@/lib/admin-i18n";
import { PageHeader } from "@/components/admin/erp/ui";
import { api, formatDate, useApi } from "@/components/admin/erp/erp-client";

const { Text, Title, Paragraph } = Typography;

type Target = "facebook" | "instagram";
interface Post {
    id: string;
    caption: string;
    media_url: string | null;
    media_type: "image" | "video" | null;
    targets: Target[];
    scheduled_at: string;
    status: "scheduled" | "publishing" | "published" | "failed";
    published: Partial<Record<Target, string>>;
    error: string | null;
    created_by_email: string | null;
}
type Media = Pick<Post, "media_url" | "media_type">;
interface Values { caption?: string; targets: Target[]; scheduled_at: Dayjs }

const STATUS: Record<Post["status"], { label: string; color: string }> = {
    scheduled: { label: msg("Scheduled"), color: "blue" },
    publishing: { label: msg("Publishing"), color: "gold" },
    published: { label: msg("Published"), color: "green" },
    failed: { label: msg("Failed"), color: "red" },
};
const ICONS: Record<Target, React.ReactNode> = {
    facebook: <FacebookFilled aria-label="Facebook" style={{ color: "#1877f2" }} />,
    instagram: <InstagramOutlined aria-label="Instagram" style={{ color: "#d62976" }} />,
};

/** Instagram only takes JPEG: photos are converted (and kept under 2000 px) before they are uploaded. */
async function toJpeg(file: File): Promise<File> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    return new File([blob!], "photo.jpg", { type: "image/jpeg" });
}

export default function PostCalendarPage() {
    const { t, locale } = useAdminT();
    const wide = Grid.useBreakpoint().md !== false;
    const [day, setDay] = useState(() => dayjs());
    // The month's grid shows days of its neighbours.
    const from = day.startOf("month").subtract(7, "day").toISOString();
    const to = day.endOf("month").add(14, "day").toISOString();
    const { data, error, reload } = useApi<{ posts: Post[]; page: { name: string; instagram: string | null } | null }>(`/api/social/posts?from=${from}&to=${to}`);
    const [editing, setEditing] = useState<Post | "new" | null>(null);
    const [media, setMedia] = useState<Media>({ media_url: null, media_type: null });
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<Values>();

    const postsOn = (d: Dayjs) => (data?.posts ?? []).filter((p) => dayjs(p.scheduled_at).isSame(d, "day"));
    const page = data?.page;

    const open = (post: Post | "new") => {
        const soon = dayjs().add(1, "hour").startOf("hour");
        const start = day.hour(soon.hour()).minute(0).second(0);
        form.setFieldsValue(post === "new"
            ? { caption: "", targets: page?.instagram ? ["facebook", "instagram"] : ["facebook"], scheduled_at: start.isBefore(dayjs()) ? soon : start }
            : { caption: post.caption, targets: post.targets, scheduled_at: dayjs(post.scheduled_at) });
        setMedia(post === "new" ? { media_url: null, media_type: null } : { media_url: post.media_url, media_type: post.media_type });
        setEditing(post);
    };

    const attempt = async (work: () => Promise<unknown>) => {
        try {
            await work();
            reload();
            return true;
        } catch (e) {
            message.error(t((e as Error).message));
            return false;
        }
    };

    const upload = async (file: File) => {
        setUploading(true);
        try {
            const body = new FormData();
            body.append("file", file.type.startsWith("image/") ? await toJpeg(file) : file);
            const { url, type } = await api<{ url: string; type: "image" | "video" }>("/api/social/media", { method: "POST", body });
            setMedia({ media_url: url, media_type: type });
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setUploading(false);
        }
    };

    const save = async (values: Values) => {
        const body = { caption: values.caption ?? "", targets: values.targets, scheduled_at: values.scheduled_at.toISOString(), ...media };
        setSaving(true);
        const done = await attempt(() => editing === "new"
            ? api("/api/social/posts", { method: "POST", body })
            : api("/api/social/posts", { method: "PATCH", body: { ...body, id: (editing as Post).id } }));
        setSaving(false);
        if (done) setEditing(null);
    };

    const dayPosts = postsOn(day);
    return (
        <div>
            <PageHeader
                title={t("Post calendar")}
                subtitle={page ? <>{page.name}{page.instagram && ` · @${page.instagram}`}</> : t("Schedule posts on your Facebook Page and Instagram.")}
                crumbs={[{ title: t("Marketing") }]}
                extra={<Button type="primary" icon={<PlusOutlined />} disabled={!page} onClick={() => open("new")}>{t("New post")}</Button>}
            />
            {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} title={t(error)} />}
            {data && !page && <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={t("Connect your Facebook Page first (Messenger → Connections).")} />}
            <Card styles={{ body: { padding: wide ? 16 : 8 } }}>
                <Calendar
                    fullscreen={wide}
                    value={day}
                    mode="month"
                    onSelect={(d) => setDay(d)}
                    onPanelChange={(d) => setDay(d)}
                    cellRender={(d, info) => {
                        if (info.type !== "date") return null;
                        const posts = postsOn(d);
                        if (!wide) return posts.length ? <span style={{ display: "block", width: 6, height: 6, borderRadius: 3, margin: "0 auto", background: "#7a3b2e" }} /> : null;
                        return posts.map((p) => (
                            <div key={p.id} title={p.caption} style={{ display: "flex", gap: 4, alignItems: "center", overflow: "hidden", whiteSpace: "nowrap", fontSize: 12, color: p.status === "failed" ? "#cf1322" : p.status === "published" ? "#389e0d" : undefined }}>
                                <b>{dayjs(p.scheduled_at).format("HH:mm")}</b>
                                {p.targets.map((target) => <span key={target}>{ICONS[target]}</span>)}
                                <bdi style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.caption}</bdi>
                            </div>
                        ));
                    }}
                />
            </Card>
            <Title level={4} style={{ marginTop: 24 }}>{formatDate(day.toISOString(), locale)}</Title>
            {dayPosts.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("No posts on this day.")} />}
            <Space orientation="vertical" style={{ width: "100%" }}>
                {dayPosts.map((p) => (
                    <Card key={p.id} size="small">
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                            {p.media_type === "image" && (
                                // eslint-disable-next-line @next/next/no-img-element -- an uploaded file, shown small to staff only
                                <img src={p.media_url!} alt="" style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 8 }} />
                            )}
                            {p.media_type === "video" && <video src={p.media_url!} controls preload="metadata" style={{ width: 160, maxHeight: 160, borderRadius: 8 }} />}
                            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                                <Space wrap size={8}>
                                    <Text strong>{dayjs(p.scheduled_at).format("HH:mm")}</Text>
                                    {p.targets.map((target) => <span key={target}>{ICONS[target]}</span>)}
                                    <Tag color={STATUS[p.status].color}>{t(STATUS[p.status].label)}</Tag>
                                </Space>
                                <Paragraph style={{ margin: "6px 0", whiteSpace: "pre-wrap" }} ellipsis={{ rows: 3, expandable: true, symbol: t("more") }}><span dir="auto">{p.caption || "—"}</span></Paragraph>
                                {p.error && <Text type="danger"><bdi>{t(p.error)}</bdi></Text>}
                                {p.status === "failed" && Object.keys(p.published).length > 0 && <Text type="secondary" style={{ display: "block" }}>{t("Already published on {where}; only the rest is sent again.", { where: Object.keys(p.published).join(", ") })}</Text>}
                            </div>
                            <Space wrap align="start">
                                {p.status === "scheduled" && <Button icon={<EditOutlined />} onClick={() => open(p)}>{t("Edit")}</Button>}
                                {p.status === "failed" && (
                                    <Popconfirm title={t("Publish again now?")} okText={t("Publish now")} cancelText={t("Cancel")} onConfirm={() => attempt(() => api("/api/social/posts/retry", { method: "POST", body: { id: p.id } }))}>
                                        <Button icon={<RedoOutlined />}>{t("Try again")}</Button>
                                    </Popconfirm>
                                )}
                                {p.status !== "publishing" && (
                                    <Popconfirm title={t("Remove this post from the calendar?")} description={p.status === "published" ? t("It stays on Facebook and Instagram.") : undefined} okText={t("Remove")} cancelText={t("Cancel")} onConfirm={() => attempt(() => api(`/api/social/posts?id=${p.id}`, { method: "DELETE" }))}>
                                        <Button danger icon={<DeleteOutlined />} aria-label={t("Remove")} />
                                    </Popconfirm>
                                )}
                            </Space>
                        </div>
                    </Card>
                ))}
            </Space>
            <Modal
                title={editing === "new" ? t("New post") : t("Edit post")}
                open={!!editing}
                onCancel={() => setEditing(null)}
                onOk={() => form.submit()}
                okText={t("Schedule")}
                cancelText={t("Cancel")}
                confirmLoading={saving}
                okButtonProps={{ disabled: uploading }}
                forceRender
            >
                <Form form={form} layout="vertical" onFinish={save}>
                    <Form.Item name="targets" label={t("Publish on")} rules={[{ required: true, message: t("Choose where to publish.") }]}>
                        <Checkbox.Group options={[{ value: "facebook", label: "Facebook" }, { value: "instagram", label: "Instagram", disabled: !page?.instagram }]} />
                    </Form.Item>
                    <Form.Item name="caption" label={t("Text")}>
                        <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} maxLength={2200} showCount dir="auto" />
                    </Form.Item>
                    <Form.Item label={t("Photo or video")} extra={t("Instagram needs one. Photos are converted to JPEG; videos are MP4, 50 MB at most.")}>
                        <Space orientation="vertical">
                            {media.media_type === "image" && (
                                // eslint-disable-next-line @next/next/no-img-element -- preview of the uploaded file
                                <img src={media.media_url!} alt="" style={{ maxWidth: 200, maxHeight: 200, borderRadius: 8 }} />
                            )}
                            {media.media_type === "video" && <video src={media.media_url!} controls preload="metadata" style={{ maxWidth: 240, maxHeight: 240, borderRadius: 8 }} />}
                            <Space wrap>
                                <Upload accept="image/jpeg,image/png,image/webp,video/mp4" showUploadList={false} beforeUpload={(file) => { void upload(file); return false; }}>
                                    <Button icon={<UploadOutlined />} loading={uploading}>{t("Choose a file")}</Button>
                                </Upload>
                                {media.media_url && <Button onClick={() => setMedia({ media_url: null, media_type: null })}>{t("Remove")}</Button>}
                            </Space>
                        </Space>
                    </Form.Item>
                    <Form.Item name="scheduled_at" label={t("Date and time")} rules={[{ required: true, message: t("Choose a time in the future.") }]}>
                        <DatePicker showTime={{ format: "HH:mm", minuteStep: 5 }} format="DD/MM/YYYY HH:mm" style={{ width: "100%" }} />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
