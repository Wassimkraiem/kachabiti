"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Badge, Button, Divider, Drawer, Empty, Grid, Popover, Space, Spin, Typography } from "antd";
import { BellOutlined, NotificationOutlined } from "@ant-design/icons";
import { useAdminRole } from "@/lib/admin-role-context";
import { useAdminT } from "@/lib/admin-i18n";
import { message } from "@/components/admin/antd-app";
import { disableDesktop, enableDesktop, getDesktopState, refreshDesktop, type DesktopState } from "@/components/admin/desktop-push";
import { NotificationItem, notificationText, type AdminNotification } from "@/components/admin/notification-item";

const { Text } = Typography;

// A short two-note chime (no audio file). Browsers allow it once the page has had a click.
function chime(urgent: boolean) {
    try {
        const ctx = new AudioContext();
        const notes = urgent ? [880, 660, 880] : [660, 880];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = freq;
            osc.connect(gain);
            gain.connect(ctx.destination);
            const start = ctx.currentTime + i * 0.18;
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
            osc.start(start);
            osc.stop(start + 0.17);
        });
        setTimeout(() => ctx.close(), 1000);
    } catch {
        // No audio available: the visual notification is enough.
    }
}

/**
 * Header bell: the user's notifications (new orders; owner alerts for owners), live through
 * the NestJS stream with a sound and a pop-up, plus the switch for mobile/desktop push notifications.
 */
export default function NotificationBell() {
    const { t, locale, dir } = useAdminT();
    // Phones get a bottom sheet instead of the popover, which can't fit next to the header icons.
    const mobile = Grid.useBreakpoint().md === false;
    const toastPlacement = mobile ? "top" as const : dir === "rtl" ? "topLeft" as const : "topRight" as const;
    const toastPlacementRef = useRef(toastPlacement);
    toastPlacementRef.current = toastPlacement;
    const { id: userId } = useAdminRole();
    const { notification } = App.useApp();
    const router = useRouter();
    const [items, setItems] = useState<AdminNotification[]>([]);
    const [unread, setUnread] = useState(0);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [desktop, setDesktop] = useState<DesktopState>("off");
    const [busy, setBusy] = useState(false);
    const localeRef = useRef(locale);
    localeRef.current = locale;

    const load = useCallback(async () => {
        try {
            const response = await fetch("/api/admin/notifications?limit=15");
            const result = await response.json();
            if (result.success) {
                setItems(result.data.rows);
                setUnread(result.data.unread);
            }
        } catch (error) {
            console.error("Error loading notifications:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        // Safety net if the live connection drops.
        const timer = setInterval(load, 60_000);
        return () => clearInterval(timer);
    }, [load]);

    // Live: new rows pop up with a sound; updated rows (grouped delete alerts) are replaced.
    // The stream (NestJS, SSE) closes every 15 minutes and EventSource reconnects, which
    // re-checks the session.
    useEffect(() => {
        if (!userId) return;
        const stream = new EventSource("/api/admin/notifications/stream");
        stream.onmessage = (event) => {
            const { op, row } = JSON.parse(event.data) as { op: "insert" | "update"; row: AdminNotification };
            if (op === "update") {
                setItems((current) => current.map((n) => (n.id === row.id ? row : n)));
                if (!row.read_at) load();
                return;
            }
            setItems((current) => [row, ...current.filter((n) => n.id !== row.id)].slice(0, 15));
            setUnread((count) => count + 1);
            const urgent = row.severity !== "info";
            chime(urgent);
            const text = notificationText(row, localeRef.current);
            notification.open({
                title: text.title,
                description: text.body,
                placement: toastPlacementRef.current,
                duration: urgent ? 0 : 8,
                type: row.severity === "critical" ? "error" : row.severity === "warning" ? "warning" : row.kind === "order" ? "success" : "info",
                onClick: () => {
                    if (row.url) router.push(row.url);
                },
                style: { cursor: row.url ? "pointer" : undefined },
            });
        };
        return () => stream.close();
    }, [userId, notification, router, load]);

    // Desktop notification state; the server keeps the admin language for push texts.
    useEffect(() => {
        getDesktopState().then(setDesktop).catch(() => setDesktop("unsupported"));
    }, []);
    useEffect(() => {
        if (desktop === "on") refreshDesktop(locale).catch(() => undefined);
    }, [desktop, locale]);

    const markRead = async (body: { ids?: number[]; all?: boolean }) => {
        await fetch("/api/admin/notifications", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const now = new Date().toISOString();
        setItems((current) => current.map((n) => (body.all || body.ids?.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n)));
        setUnread((count) => (body.all ? 0 : Math.max(0, count - (body.ids?.length ?? 0))));
    };

    const openItem = (item: AdminNotification) => {
        if (!item.read_at) markRead({ ids: [item.id] });
        setOpen(false);
        if (item.url) router.push(item.url);
    };

    const toggleDesktop = async () => {
        setBusy(true);
        try {
            const next = desktop === "on" ? await disableDesktop() : await enableDesktop(locale);
            setDesktop(next);
            if (next === "on") message.success(t("Push notifications are on for this device"));
            if (next === "denied") message.warning(t("Notifications are blocked for this site. Allow them in the browser's site settings."));
        } catch (error) {
            message.error((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const sendTest = async () => {
        const response = await fetch("/api/admin/notifications/test", { method: "POST" });
        const result = await response.json();
        if (!result.success) message.error(result.error);
    };

    const content = (
        <div style={{ width: mobile ? "100%" : 380, maxWidth: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <Text strong>{t("Notifications")}</Text>
                <Button type="link" size="small" disabled={unread === 0} onClick={() => markRead({ all: true })}>
                    {t("Mark all as read")}
                </Button>
            </div>
            <div style={{ maxHeight: mobile ? "calc(85vh - 190px)" : 420, overflowY: "auto", marginInline: -12 }}>
                {loading ? (
                    <div style={{ textAlign: "center", padding: 24 }}><Spin /></div>
                ) : items.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("No notifications yet")} />
                ) : (
                    items.map((item) => <NotificationItem key={item.id} item={item} onOpen={openItem} compact />)
                )}
            </div>
            <Divider style={{ margin: "8px 0" }} />
            <Space orientation="vertical" style={{ width: "100%" }} size={4}>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <Space size={6} style={{ minWidth: 0 }}>
                        <NotificationOutlined />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            {desktop === "on" ? t("Push notifications: on")
                                : desktop === "denied" ? t("Push notifications: blocked in the browser")
                                : desktop === "unsupported" ? t("Push notifications: not supported by this browser")
                                : t("Push notifications: off")}
                        </Text>
                    </Space>
                    {(desktop === "on" || desktop === "off") && (
                        <Button size="small" type={desktop === "on" ? "default" : "primary"} loading={busy} onClick={toggleDesktop}>
                            {desktop === "on" ? t("Turn off") : t("Turn on")}
                        </Button>
                    )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <Button type="link" size="small" style={{ paddingInline: 0 }} onClick={sendTest}>{t("Send a test notification")}</Button>
                    <Link href="/admin/notifications" onClick={() => setOpen(false)}>{t("See all")}</Link>
                </div>
            </Space>
        </div>
    );

    const bell = <Button type="text" aria-label={t("Notifications")} onClick={mobile ? () => setOpen(true) : undefined} icon={<Badge count={unread} size="small" overflowCount={99}><BellOutlined style={{ fontSize: 18 }} /></Badge>} />;

    if (mobile) {
        return (
            <>
                {bell}
                <Drawer open={open} onClose={() => setOpen(false)} placement="bottom" size="85vh" closable={false} styles={{ body: { padding: "16px 16px calc(12px + env(safe-area-inset-bottom))" } }}>
                    {content}
                </Drawer>
            </>
        );
    }

    return (
        <Popover content={content} trigger="click" open={open} onOpenChange={setOpen} placement={dir === "rtl" ? "bottomLeft" : "bottomRight"} arrow={false}>
            {bell}
        </Popover>
    );
}
