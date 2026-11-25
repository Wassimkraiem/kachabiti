import type { AdminNotification } from "@/components/admin/notification-item";

export type StreamEvent = { op: "insert" | "update"; row: AdminNotification };

const listeners = new Set<(event: StreamEvent) => void>();
let stream: EventSource | null = null;
let live = false;

/** True while the live stream is up. */
export const streamIsLive = () => live;

/**
 * The user's live notifications (NestJS, SSE), one connection shared by the header icons. It closes
 * every 15 minutes and EventSource reconnects, which re-checks the session.
 */
export function listenNotifications(listener: (event: StreamEvent) => void) {
    listeners.add(listener);
    if (!stream) {
        stream = new EventSource("/api/admin/notifications/stream");
        stream.onopen = () => { live = true; };
        stream.onerror = () => { live = false; };
        stream.onmessage = (event) => {
            const data = JSON.parse(event.data) as StreamEvent;
            listeners.forEach((notify) => notify(data));
        };
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        stream?.close();
        stream = null;
        live = false;
    };
}
