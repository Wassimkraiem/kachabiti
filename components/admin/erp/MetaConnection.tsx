"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Popconfirm, Select, Space, Typography } from "antd";
import { FacebookOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { msg, useAdminT } from "@/lib/admin-i18n";
import { api, formatDate, useApi } from "./erp-client";

const { Text } = Typography;
const LOGIN = "/api/admin/meta/login";

interface Status {
    available: boolean;
    page: { name: string; instagram: string | null; data_access_expires_at: string | null } | null;
}
interface GrantedPage { id: string; name: string; instagram: string | null }

const RESULTS: Record<string, string> = {
    expired: msg("The Facebook sign-in has expired. Connect again."),
    cancelled: msg("The Facebook sign-in was cancelled."),
    failed: msg("Facebook refused the connection. Try again."),
};

/** Admins connect the Facebook Page (and its Instagram account) here, instead of copying tokens. */
export default function MetaConnection({ onChange }: { onChange: () => void }) {
    const { t, locale } = useAdminT();
    const { data: status, reload } = useApi<Status>("/api/admin/meta");
    const [choosing, setChoosing] = useState(false);
    const { data: pages, error } = useApi<GrantedPage[]>(choosing ? "/api/admin/meta/pages" : null);
    const [pageId, setPageId] = useState<string>();
    const [busy, setBusy] = useState(false);

    // Back from Facebook: ?meta=choose, or why it didn't work.
    useEffect(() => {
        const result = new URLSearchParams(window.location.search).get("meta");
        if (!result) return;
        window.history.replaceState(null, "", window.location.pathname);
        if (result === "choose") setChoosing(true);
        else if (RESULTS[result]) message.error(t(RESULTS[result]));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
    }, []);

    const run = async (work: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await work();
            setChoosing(false);
            reload();
            onChange();
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setBusy(false);
        }
    };

    if (!status || (!status.available && !status.page)) return null;
    const { page } = status;
    return (
        <Card size="small" title={t("Facebook Page")} style={{ marginBottom: 16 }}>
            {choosing ? (
                <Space wrap>
                    {error && <Alert type="error" showIcon title={t(error)} />}
                    {pages?.length === 0 && <Alert type="warning" showIcon title={t("No Page was granted. Connect again and choose your Page.")} />}
                    {pages && pages.length > 0 && (
                        <>
                            <Select
                                aria-label={t("Choose a Page")}
                                placeholder={t("Choose a Page")}
                                value={pageId}
                                onChange={setPageId}
                                style={{ minWidth: 260 }}
                                options={pages.map((p) => ({ value: p.id, label: p.instagram ? `${p.name} (@${p.instagram})` : p.name }))}
                            />
                            <Button type="primary" disabled={!pageId} loading={busy} onClick={() => run(() => api("/api/admin/meta", { method: "POST", body: { page_id: pageId } }))}>
                                {t("Connect this Page")}
                            </Button>
                        </>
                    )}
                    <Button onClick={() => setChoosing(false)}>{t("Cancel")}</Button>
                </Space>
            ) : (
                <Space wrap>
                    {page && (
                        <Text>
                            <Text strong>{page.name}</Text>
                            {page.instagram && ` · @${page.instagram}`}
                        </Text>
                    )}
                    {page?.data_access_expires_at && (
                        <Text type="secondary">{t("Connect again before {date}", { date: formatDate(page.data_access_expires_at, locale) })}</Text>
                    )}
                    {status.available && (
                        <Button type={page ? "default" : "primary"} icon={<FacebookOutlined />} href={LOGIN}>
                            {page ? t("Change Page") : t("Connect with Facebook")}
                        </Button>
                    )}
                    {page && (
                        <Popconfirm title={t("Disconnect this Page?")} description={t("New messages and comments will stop arriving.")} okText={t("Disconnect")} cancelText={t("Cancel")} onConfirm={() => run(() => api("/api/admin/meta", { method: "DELETE" }))}>
                            <Button danger loading={busy}>{t("Disconnect")}</Button>
                        </Popconfirm>
                    )}
                </Space>
            )}
        </Card>
    );
}
