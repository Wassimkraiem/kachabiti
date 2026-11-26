"use client";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Typography } from "antd";
import { ExclamationCircleFilled, InfoCircleFilled, MessageOutlined, ShoppingCartOutlined, WarningFilled, BellFilled, UserOutlined } from "@ant-design/icons";
import { useAdminT, type AdminLocale } from "@/lib/admin-i18n";
import { MESSAGE_NOTIFICATIONS } from "@/lib/erp/notification-types";

dayjs.extend(relativeTime);

const { Text } = Typography;

type Localized = Partial<Record<AdminLocale, string>> | null;

export interface AdminNotification {
    id: number;
    created_at: string;
    kind: "order" | "security" | "system";
    type: string;
    severity: "info" | "warning" | "critical";
    title: Localized;
    body: Localized;
    url: string | null;
    data: Record<string, unknown>;
    read_at: string | null;
}

/** Title and body in the admin language (texts are stored in en/fr/ar by the database). */
export function notificationText(item: Pick<AdminNotification, "title" | "body">, locale: AdminLocale) {
    return {
        title: item.title?.[locale] || item.title?.en || "",
        body: item.body?.[locale] || item.body?.en || "",
    };
}

function Icon({ item }: { item: AdminNotification }) {
    const style = { fontSize: 18 };
    if (item.type === "assigned_message") return <UserOutlined style={{ ...style, color: "#7a3b2e" }} />;
    if (MESSAGE_NOTIFICATIONS.includes(item.type)) return <MessageOutlined style={{ ...style, color: "#7a3b2e" }} />;
    if (item.kind === "order") return <ShoppingCartOutlined style={{ ...style, color: "#389e0d" }} />;
    if (item.severity === "critical") return <ExclamationCircleFilled style={{ ...style, color: "#cf1322" }} />;
    if (item.severity === "warning") return <WarningFilled style={{ ...style, color: "#d48806" }} />;
    if (item.kind === "system") return <BellFilled style={{ ...style, color: "#7a3b2e" }} />;
    return <InfoCircleFilled style={{ ...style, color: "#1677ff" }} />;
}

export function NotificationItem({ item, onOpen, compact }: { item: AdminNotification; onOpen: (item: AdminNotification) => void; compact?: boolean }) {
    const { locale } = useAdminT();
    const text = notificationText(item, locale);
    const unread = !item.read_at;
    return (
        <button
            type="button"
            onClick={() => onOpen(item)}
            style={{
                display: "flex",
                gap: 12,
                width: "100%",
                textAlign: "start",
                padding: compact ? "10px 12px" : "14px 16px",
                border: 0,
                borderBottom: "1px solid #f0f0f0",
                background: unread ? "#fdf6f2" : "transparent",
                cursor: "pointer",
            }}
        >
            <span style={{ paddingTop: 2 }}><Icon item={item} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
                <Text strong={unread} style={{ display: "block" }}>{text.title}</Text>
                {text.body && <Text type="secondary" style={{ display: "block", fontSize: 13 }} ellipsis={compact}>{text.body}</Text>}
                <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(item.created_at).locale(locale).fromNow()}</Text>
            </span>
            {unread && <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: "#7a3b2e", marginTop: 8, flexShrink: 0 }} />}
        </button>
    );
}
