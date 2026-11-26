"use client";

import { useState } from "react";
import Link from "next/link";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, Card, Col, DatePicker, Drawer, Empty, Row, Table, Tag, Typography } from "antd";
import { FacebookFilled, InstagramFilled } from "@ant-design/icons";
import { useAdminT } from "@/lib/admin-i18n";
import { Kpi, PageHeader } from "@/components/admin/erp/ui";
import { day, formatDate, formatMoney, formatNumber, useApi } from "@/components/admin/erp/erp-client";

const { Text } = Typography;

interface Person { id: string; name: string; channel: string; referred_at: string; ad: string | null; orders: number; delivered: number }
interface Crm { conversations: number; orders: number; delivered: number; revenue: number; people: Person[] }
interface Campaign {
    id: string;
    name: string;
    status: string;
    objective: string | null;
    daily_budget: number | null;
    lifetime_budget: number | null;
    meta: { spend: number; impressions: number; reach: number; clicks: number; ctr: number; cpc: number; cpm: number; frequency: number; conversations_started: number };
    crm: Crm;
}
interface Report { account: { id: string; name: string | null; currency: string | null }; campaigns: Campaign[]; other: Crm; attribution_days: number }

const STATUS_COLORS: Record<string, string> = { ACTIVE: "green", PAUSED: "default", CAMPAIGN_PAUSED: "default", ARCHIVED: "default", DELETED: "red", IN_PROCESS: "blue", WITH_ISSUES: "orange" };

/**
 * Admin → Marketing → Meta ads: Meta's figures per campaign (spend, reach, clicks…) next to what the
 * CRM saw: conversations that started from its ads, and those customers' orders.
 */
export default function MetaAdsPage() {
    const { t, locale } = useAdminT();
    const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(29, "day"), dayjs()]);
    const [open, setOpen] = useState<{ name: string; crm: Crm } | null>(null);
    const { data, loading, error } = useApi<Report>(`/api/marketing/meta-ads?from=${day(range[0])}&to=${day(range[1])}`);

    const currency = data?.account.currency ?? "";
    const money = (n: number) => `${formatNumber(n, locale, 2)} ${currency}`;
    const sum = (pick: (c: Campaign) => number) => (data?.campaigns ?? []).reduce((total, c) => total + pick(c), 0);
    const spend = sum((c) => c.meta.spend);
    const clicks = sum((c) => c.meta.clicks);
    const impressions = sum((c) => c.meta.impressions);
    const conversations = sum((c) => c.crm.conversations) + (data?.other.conversations ?? 0);
    const delivered = sum((c) => c.crm.delivered) + (data?.other.delivered ?? 0);
    const revenue = sum((c) => c.crm.revenue) + (data?.other.revenue ?? 0);
    // Cost per sale only when both are in dinars: otherwise the currencies don't mix.
    const sameMoney = currency === "TND";

    return (
        <div>
            <PageHeader
                title={t("Meta ads")}
                subtitle={data ? `${data.account.name ?? data.account.id} · ${currency}` : t("Your Facebook and Instagram campaigns, and what they brought")}
                crumbs={[{ title: t("Marketing") }]}
                extra={<DatePicker.RangePicker value={range} allowClear={false} onChange={(v) => v?.[0] && v[1] && setRange([v[0], v[1]])} />}
            />
            {error && (
                <Alert
                    type={error.startsWith("Choose your ad account") ? "info" : "error"}
                    showIcon
                    style={{ marginBottom: 16 }}
                    title={t(error)}
                    description={error.startsWith("Choose your ad account") ? t("Add ads_read to the login configuration, connect the Page again, then choose the ad account in Messenger → Connections.") : undefined}
                />
            )}
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={12} md={6}><Kpi loading={loading} title={t("Spent (Meta)")} value={money(spend)} /></Col>
                <Col xs={12} md={6}><Kpi loading={loading} title={t("Impressions")} value={formatNumber(impressions, locale)} sub={`${t("Clicks")}: ${formatNumber(clicks, locale)}`} /></Col>
                <Col xs={12} md={6}><Kpi loading={loading} title={t("Conversations from ads")} value={formatNumber(conversations, locale)} hint={t("People who wrote after clicking an ad, seen by the CRM.")} /></Col>
                <Col xs={12} md={6}>
                    <Kpi
                        loading={loading}
                        title={t("Delivered sales")}
                        value={formatNumber(delivered, locale)}
                        sub={formatMoney(revenue, locale)}
                        hint={t("Orders delivered to people who wrote after an ad, placed within {days} days of their message.", { days: data?.attribution_days ?? 30 })}
                    />
                </Col>
            </Row>
            <Card>
                <Table<Campaign>
                    rowKey="id"
                    loading={loading}
                    dataSource={data?.campaigns ?? []}
                    scroll={{ x: 1300 }}
                    pagination={false}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("No campaign in this period.")} /> }}
                    onRow={(c) => ({ onClick: () => setOpen({ name: c.name, crm: c.crm }), style: { cursor: "pointer" } })}
                    columns={[
                        { title: t("Campaign"), dataIndex: "name", fixed: "left", width: 240, render: (name: string, c) => (
                            <div>
                                <div dir="auto" style={{ fontWeight: 600 }}>{name}</div>
                                <Tag color={STATUS_COLORS[c.status] ?? "default"} style={{ marginTop: 4 }}>{c.status.toLowerCase().replace(/_/g, " ")}</Tag>
                            </div>
                        ) },
                        { title: t("Spent"), align: "right", render: (_, c) => money(c.meta.spend), sorter: (a, b) => a.meta.spend - b.meta.spend },
                        { title: t("Reach"), align: "right", render: (_, c) => formatNumber(c.meta.reach, locale) },
                        { title: t("Impressions"), align: "right", render: (_, c) => formatNumber(c.meta.impressions, locale) },
                        { title: t("Clicks"), align: "right", render: (_, c) => formatNumber(c.meta.clicks, locale) },
                        { title: "CTR", align: "right", render: (_, c) => `${formatNumber(c.meta.ctr, locale, 2)} %` },
                        { title: "CPC", align: "right", render: (_, c) => money(c.meta.cpc) },
                        { title: "CPM", align: "right", render: (_, c) => money(c.meta.cpm) },
                        { title: t("Conversations (Meta)"), align: "right", render: (_, c) => formatNumber(c.meta.conversations_started, locale) },
                        { title: t("Conversations (CRM)"), align: "right", render: (_, c) => <Text strong>{formatNumber(c.crm.conversations, locale)}</Text>, sorter: (a, b) => a.crm.conversations - b.crm.conversations },
                        { title: t("Orders"), align: "right", render: (_, c) => formatNumber(c.crm.orders, locale) },
                        { title: t("Delivered"), align: "right", render: (_, c) => formatNumber(c.crm.delivered, locale) },
                        { title: t("Revenue"), align: "right", render: (_, c) => formatMoney(c.crm.revenue, locale) },
                        ...(sameMoney ? [{ title: t("Cost per delivered sale"), align: "right" as const, render: (_: unknown, c: Campaign) => (c.crm.delivered ? money(c.meta.spend / c.crm.delivered) : "—") }] : []),
                    ]}
                />
                {!!data?.other.conversations && (
                    <Text type="secondary" style={{ display: "block", marginTop: 12, cursor: "pointer" }} onClick={() => setOpen({ name: t("Other ads"), crm: data.other })}>
                        {t("{count} conversation(s) came from ads outside this account or deleted.", { count: data.other.conversations })}
                    </Text>
                )}
                <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
                    {t("Meta counts conversations its way (7 days after a click); the CRM counts the people who wrote with the ad's referral, from the moment the update is live.")}
                </Text>
            </Card>
            <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.name} size="large">
                {open && !open.crm.people.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("No conversation from this campaign yet.")} />}
                {open && open.crm.people.length > 0 && (
                    <Table<Person>
                        rowKey="id"
                        size="small"
                        pagination={false}
                        dataSource={open.crm.people}
                        columns={[
                            { title: t("Customer"), render: (_, p) => (
                                <Link href={`/admin/customers/${p.id}`}>
                                    {p.channel === "instagram" ? <InstagramFilled style={{ color: "#d62976" }} /> : <FacebookFilled style={{ color: "#1877f2" }} />} <bdi>{p.name || t("(no name)")}</bdi>
                                </Link>
                            ) },
                            { title: t("Wrote on"), render: (_, p) => formatDate(p.referred_at, locale, true) },
                            { title: t("Ad"), render: (_, p) => <Text dir="auto" type="secondary">{p.ad ?? "—"}</Text> },
                            { title: t("Orders"), align: "right", render: (_, p) => p.orders },
                            { title: t("Delivered"), align: "right", render: (_, p) => p.delivered },
                        ]}
                    />
                )}
            </Drawer>
        </div>
    );
}
