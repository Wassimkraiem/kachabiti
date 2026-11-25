"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Empty, Segmented, Space, Spin, Typography } from "antd";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { useAdminRole } from "@/lib/admin-role-context";
import { NotificationItem, type AdminNotification } from "@/components/admin/notification-item";

const { Title, Paragraph } = Typography;

type Filter = "all" | "unread" | "order" | "messages" | "security";

export default function NotificationsPage() {
    const { t } = useAdminT();
    const { isOwner, isAdmin } = useAdminRole();
    const router = useRouter();
    const [filter, setFilter] = useState<Filter>("all");
    const [items, setItems] = useState<AdminNotification[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async (before?: number) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: "30" });
            if (before) params.set("before", String(before));
            if (filter === "unread") params.set("unread", "1");
            if (filter === "order" || filter === "security") params.set("kind", filter);
            if (filter === "order") params.set("scope", "other");
            if (filter === "messages") params.set("scope", "messages");
            const response = await fetch(`/api/admin/notifications?${params}`);
            const result = await response.json();
            if (!result.success) throw new Error(result.error);
            setItems((current) => (before ? [...current, ...result.data.rows] : result.data.rows));
            setHasMore(result.data.hasMore);
        } catch (error) {
            console.error("Error loading notifications:", error);
            message.error(t("Failed to load notifications"));
        } finally {
            setLoading(false);
        }
    }, [filter, t]);

    useEffect(() => {
        load();
    }, [load]);

    const markRead = async (body: { ids?: number[]; all?: boolean }) => {
        await fetch("/api/admin/notifications", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const now = new Date().toISOString();
        setItems((current) => current.map((n) => (body.all || body.ids?.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n)));
    };

    const open = (item: AdminNotification) => {
        if (!item.read_at) markRead({ ids: [item.id] });
        if (item.url) router.push(item.url);
    };

    const options = [
        { value: "all", label: t("All") },
        { value: "unread", label: t("Unread") },
        { value: "order", label: t("Orders") },
        { value: "messages", label: t("Messages and comments") },
        // Owner alerts go to owners (and to admins while the business has no owner).
        ...(isOwner || isAdmin ? [{ value: "security", label: t("Owner alerts") }] : []),
    ];

    return (
        <div style={{ padding: 24 }}>
            <Title level={2} style={{ marginTop: 0 }}>{t("Notifications")}</Title>
            <Paragraph type="secondary">
                {isOwner
                    ? t("New orders, and alerts about deletes and unusual actions by admins and staff.")
                    : t("New orders and other notifications for you.")}
            </Paragraph>
            <Card>
                <Space style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", flexWrap: "wrap" }}>
                    <Segmented value={filter} onChange={(value) => setFilter(value as Filter)} options={options} />
                    <Button onClick={() => markRead({ all: true })}>{t("Mark all as read")}</Button>
                </Space>
                {items.length === 0 && !loading ? (
                    <Empty description={t("No notifications yet")} />
                ) : (
                    <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, overflow: "hidden" }}>
                        {items.map((item) => <NotificationItem key={item.id} item={item} onOpen={open} />)}
                    </div>
                )}
                <div style={{ textAlign: "center", marginTop: 16 }}>
                    {loading ? <Spin /> : hasMore && <Button onClick={() => load(items[items.length - 1]?.id)}>{t("Load more")}</Button>}
                </div>
            </Card>
        </div>
    );
}
