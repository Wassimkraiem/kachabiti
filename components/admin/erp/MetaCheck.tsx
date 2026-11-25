"use client";

import { useState } from "react";
import { Alert, Button, Space, Typography } from "antd";
import { CheckCircleFilled, CloseCircleFilled } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { msg, useAdminT } from "@/lib/admin-i18n";
import { api, formatDate } from "./erp-client";

const { Text } = Typography;

interface Check { id: string; ok: boolean; detail: string | null }
interface Result { checks: Check[]; received: Record<"page" | "instagram" | "refused", string | null> }

const LABELS: Record<string, string> = {
    app: msg("App ID and secret"),
    page: msg("A Page is connected"),
    token: msg("Page token of this app"),
    scope_messages: msg("Permission: Messenger messages"),
    scope_comments: msg("Permission: Facebook comments"),
    scope_instagram_messages: msg("Permission: Instagram messages"),
    scope_instagram_comments: msg("Permission: Instagram comments"),
    scope_publish: msg("Permission: publish posts"),
    instagram: msg("Instagram account linked to the Page"),
    page_subscription: msg("Page events"),
    webhook_page: msg("Facebook webhook"),
    webhook_instagram: msg("Instagram webhook"),
    import_facebook: msg("Messenger history read (conversations / messages added)"),
    import_instagram: msg("Instagram history read (conversations / messages added)"),
};

/** Asks Meta what is missing for messages and comments to arrive, and repairs the subscriptions. */
export default function MetaCheck() {
    const { t, locale } = useAdminT();
    const [result, setResult] = useState<Result | null>(null);
    const [busy, setBusy] = useState<"check" | "repair" | null>(null);

    const run = async (repair: boolean) => {
        setBusy(repair ? "repair" : "check");
        try {
            if (repair) await api("/api/admin/meta/repair", { method: "POST" });
            setResult(await api<Result>("/api/admin/meta/check"));
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setBusy(null);
        }
    };

    const seen = (value: string | null | undefined) => (value ? formatDate(value.split(" ")[0], locale, true) : t("nothing yet"));
    return (
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
            <Space wrap>
                <Button loading={busy === "check"} disabled={!!busy} onClick={() => run(false)}>{t("Check the connection")}</Button>
                {result && <Button loading={busy === "repair"} disabled={!!busy} onClick={() => run(true)}>{t("Repair the events")}</Button>}
            </Space>
            {result && (
                <>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                        {result.checks.map((c) => (
                            <li key={c.id} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                                {c.ok ? <CheckCircleFilled aria-label={t("OK")} style={{ color: "#389e0d" }} /> : <CloseCircleFilled aria-label={t("Missing")} style={{ color: "#cf1322" }} />}
                                <span>
                                    {t(LABELS[c.id] ?? c.id)}
                                    {c.detail && <Text type="secondary" style={{ display: "block", fontSize: 12, overflowWrap: "anywhere" }}><bdi>{c.detail}</bdi></Text>}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <Text type="secondary">
                        {t("Last event since the server started: Facebook {facebook}, Instagram {instagram}.", { facebook: seen(result.received.page), instagram: seen(result.received.instagram) })}
                    </Text>
                    {result.received.refused && (
                        <Alert type="error" showIcon title={t("Events were refused: META_APP_SECRET is not the secret of the app that sent them ({what}).", { what: result.received.refused.split(" ")[1] })} />
                    )}
                    <Alert type="info" showIcon title={t("All green but only testers appear? The app needs Advanced Access (App Review) for each permission.")} />
                </>
            )}
        </Space>
    );
}
