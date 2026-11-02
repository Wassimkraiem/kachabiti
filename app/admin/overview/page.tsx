"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import { Alert, Button, Card, Col, Divider, Row, Select, Table, Tag, Typography } from "antd";
import { ReloadOutlined, WarningOutlined } from "@ant-design/icons";
import { useAdminT } from "@/lib/admin-i18n";
import { CHANNELS, CHANNEL_LABELS, type Channel } from "@/lib/erp/constants";
import { AgentSelect, ChannelTag, Kpi, PageHeader, PeriodFilter, usePeriod } from "@/components/admin/erp/ui";
import { BarChart, BarList, TargetBar } from "@/components/admin/erp/charts";
import { formatMoney, formatNumber, percent, useApi } from "@/components/admin/erp/erp-client";
import MonthGoalCard, { type MonthGoal } from "@/components/admin/erp/MonthGoalCard";

const { Text } = Typography;

interface Overview {
    analytics_start?: string | null;
    orders: { created: number; created_value: number; confirmed: number; delivered: number; returned: number; cancelled: number; pending_now: number; in_delivery_now: number; finished: number };
    money: {
        delivered_revenue: number; delivered_revenue_ht: number; cogs: number; missing_cost_lines: number; gross_margin: number; ad_spend: number;
        operating_expenses: number; fixed_expenses: number; purchases: number; delivery_fees: number; net_margin: number; collected: number;
        receivable: number; cost_per_delivered_sale: number | null; vat_rate: number;
    };
    treasury: { cash: number; bank: number; carrier: number; open_tills: number; supplier_debt: number; due_7_days: number; overdue: number };
    stock: { value: number; units: number; materials_value: number; low: number; out: number; products_without_cost: number };
    daily: { day: string; created: number; confirmed: number; delivered: number; revenue: number; returned: number; collected: number; ad_spend: number }[];
    channels: { channel: Channel; created: number; confirmed: number; delivered: number; returned: number; revenue: number }[];
    products: { product_id: string; name: string; quantity: number; revenue: number; cost: number; margin: number; missing_cost: boolean }[];
    agents: { agent_id: string; email: string | null; created: number; confirmed: number; delivered: number; returned: number; delivered_revenue: number }[];
    campaigns: { campaign_id: string; name: string; platform: string; spend: number; orders: number; delivered: number; revenue: number }[];
    goals: { user_id: string; target_orders: number | null; target_confirmed: number | null; target_delivered: number | null; target_revenue: number | null }[];
    campaign_options: { id: string; name: string }[];
    cost_prices: { product_id: string; product_name: string; cost_price: number | null; base_price: number; margin_percent: number | null }[];
    month_goal?: MonthGoal;
}

/**
 * Admin → Business overview (owners only). What the business really earned and where the money
 * is: delivered sales (not just orders taken), margins after cost of goods, ads, expenses and
 * delivery fees, cash in the till and the bank, what the delivery company and customers still owe,
 * supplier debts, stock value, and how channels, products, agents and campaigns perform.
 */
export default function OwnerOverviewPage() {
    const { t, locale } = useAdminT();
    const { value: periodValue, setValue: setPeriod, from, to } = usePeriod("month");
    const [channel, setChannel] = useState<string>("");
    const [agent, setAgent] = useState<string | null>(null);
    const [product, setProduct] = useState<string>("");
    const [campaign, setCampaign] = useState<string>("");

    const url = useMemo(() => {
        const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
        if (channel) qs.set("channel", channel);
        if (agent) qs.set("agent", agent);
        if (product) qs.set("product", product);
        if (campaign) qs.set("campaign", campaign);
        return `/api/owner/overview?${qs}`;
    }, [from, to, channel, agent, product, campaign]);
    const { data, loading, error, reload } = useApi<Overview>(url);

    const money = (n: number | null | undefined, digits = 0) => formatMoney(n ?? 0, locale, digits);
    const m = data?.money;
    const o = data?.orders;
    const finished = (o?.delivered ?? 0) + (o?.returned ?? 0);
    const deliveryRate = percent(o?.delivered ?? 0, finished);
    const returnRate = percent(o?.returned ?? 0, finished);
    const grossPct = m && m.delivered_revenue_ht > 0 ? Math.round((m.gross_margin / m.delivered_revenue_ht) * 1000) / 10 : null;
    const netPct = m && m.delivered_revenue_ht > 0 ? Math.round((m.net_margin / m.delivered_revenue_ht) * 1000) / 10 : null;
    const days = (data?.daily ?? []).map((d) => ({ ...d, label: dayjs(d.day).format("DD/MM") }));
    const goalOf = (userId: string) => data?.goals.find((g) => g.user_id === userId);
    const missingCost = (data?.cost_prices ?? []).filter((p) => p.cost_price === null);

    return (
        <div>
            <PageHeader
                title={t("Business overview")}
                subtitle={t("What the business really earned, where the money is, and what to watch.")}
                extra={<Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>{t("Refresh")}</Button>}
            />

            {data?.analytics_start && (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    title={t("Figures count from {date} (analytics reset).", { date: dayjs(data.analytics_start).format("DD/MM/YYYY") })}
                    action={<Link href="/admin/settings">{t("Change")}</Link>}
                />
            )}

            <Card style={{ marginBottom: 16 }} classNames={{ body: "admin-filters" }} styles={{ body: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } }}>
                <PeriodFilter value={periodValue} onChange={setPeriod} />
                <Select
                    value={channel}
                    onChange={setChannel}
                    style={{ minWidth: 160 }}
                    options={[{ value: "", label: t("All channels") }, ...CHANNELS.map((c) => ({ value: c, label: t(CHANNEL_LABELS[c]) }))]}
                />
                <AgentSelect value={agent} onChange={setAgent} placeholder={t("All agents")} allowNobody={false} style={{ minWidth: 180 }} />
                {agent && <Button type="link" onClick={() => setAgent(null)}>{t("All agents")}</Button>}
                <Select
                    value={product}
                    onChange={setProduct}
                    style={{ minWidth: 200 }}
                    showSearch
                    optionFilterProp="label"
                    options={[{ value: "", label: t("All products") }, ...(data?.cost_prices ?? []).map((p) => ({ value: p.product_id, label: p.product_name }))]}
                />
                <Select
                    value={campaign}
                    onChange={setCampaign}
                    style={{ minWidth: 180 }}
                    options={[{ value: "", label: t("All campaigns") }, ...(data?.campaign_options ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                />
            </Card>

            {error && <Alert type="error" showIcon title={t(error)} style={{ marginBottom: 16 }} />}
            {data && (m!.missing_cost_lines > 0 || data.stock.products_without_cost > 0) && (
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    title={t("{count} product(s) have no purchase cost, so their margin can't be counted.", { count: data.stock.products_without_cost })}
                    description={
                        <span>
                            {m!.missing_cost_lines > 0 && <>{t("{count} delivered line(s) in this period are affected.", { count: m!.missing_cost_lines })} </>}
                            {t("Enter each product's cost on its product page (Purchase cost per unit). Past orders take it automatically.")}{" "}
                            {missingCost.length > 0 && <>{t("Missing")}: {missingCost.slice(0, 6).map((p, i) => <span key={p.product_id}>{i > 0 && ", "}<Link href={`/admin/products/${p.product_id}/edit`}>{p.product_name}</Link></span>)}{missingCost.length > 6 && "…"}</>}
                        </span>
                    }
                />
            )}

            {data?.month_goal?.goal && <MonthGoalCard goal={data.month_goal} money={money} />}

            <Divider titlePlacement="start" style={{ marginTop: 0 }}>{t("Earnings")}</Divider>
            <Row gutter={[16, 16]}>
                <Col xs={12} lg={6}><Kpi loading={loading} title={t("Delivered sales")} value={money(m?.delivered_revenue)} hint={t("Orders delivered in the period, with VAT. Orders taken but not delivered are not sales yet.")} sub={t("{amount} before VAT", { amount: money(m?.delivered_revenue_ht) })} /></Col>
                <Col xs={12} lg={6}><Kpi loading={loading} title={t("Gross margin")} value={money(m?.gross_margin)} hint={t("Sales before VAT minus what the delivered products cost (weighted average cost).")} sub={grossPct !== null ? `${grossPct}%` : undefined} color={m && m.gross_margin < 0 ? "#cf1322" : undefined} /></Col>
                <Col xs={12} lg={6}><Kpi loading={loading} title={t("Estimated net margin")} value={money(m?.net_margin)} hint={t("Gross margin minus ads, expenses (bills except stock purchases) and delivery fees of the period.")} sub={netPct !== null ? `${netPct}%` : undefined} color={m && m.net_margin < 0 ? "#cf1322" : "#389e0d"} /></Col>
                <Col xs={12} lg={6}><Kpi loading={loading} title={t("Money collected")} value={money(m?.collected)} hint={t("Payments received in the period (till, bank, cash on delivery).")} sub={t("{amount} still to collect from delivered orders", { amount: money(m?.receivable) })} /></Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={14}>
                    <Card title={t("Profit and loss (estimate)")} style={{ height: "100%" }}>
                        <PnlLine label={t("Sales before VAT")} value={m?.delivered_revenue_ht} money={money} strong />
                        <PnlLine label={t("Cost of products sold")} value={m ? -m.cogs : undefined} money={money} />
                        <PnlLine label={t("Gross margin")} value={m?.gross_margin} money={money} strong border />
                        <PnlLine label={t("Advertising")} value={m ? -m.ad_spend : undefined} money={money} />
                        <PnlLine label={t("Expenses (rent, salaries, utilities...)")} value={m ? -m.operating_expenses : undefined} money={money} sub={m ? t("of which fixed: {amount}", { amount: money(m.fixed_expenses) }) : undefined} />
                        <PnlLine label={t("Delivery company fees")} value={m ? -m.delivery_fees : undefined} money={money} />
                        <PnlLine label={t("Estimated net margin")} value={m?.net_margin} money={money} strong border />
                        <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
                            {t("Stock bought in the period ({amount}) is not an expense here: products cost the margin when they are sold.", { amount: money(m?.purchases) })}
                        </Text>
                    </Card>
                </Col>
                <Col xs={24} lg={10}>
                    <Card title={t("Where the money is")} style={{ height: "100%" }} extra={<Link href="/admin/finance/treasury">{t("Cash & bank")}</Link>}>
                        <PnlLine label={t("Cash register")} value={data?.treasury.cash} money={money} />
                        <PnlLine label={t("Bank")} value={data?.treasury.bank} money={money} />
                        <PnlLine label={t("Held by the delivery company")} value={data?.treasury.carrier} money={money} sub={t("Delivered and paid at Colissimo, not paid out yet")} />
                        <PnlLine label={t("Owed by customers")} value={m?.receivable} money={money} sub={t("Delivered orders not paid yet")} />
                        <PnlLine label={t("Owed to suppliers")} value={data ? -data.treasury.supplier_debt : undefined} money={money} border />
                        {data && data.treasury.overdue > 0 && (
                            <Alert type="error" showIcon icon={<WarningOutlined />} style={{ marginTop: 8 }} title={t("{amount} of bills are overdue", { amount: money(data.treasury.overdue) })} action={<Link href="/admin/finance/bills?status=overdue">{t("See")}</Link>} />
                        )}
                        {data && data.treasury.due_7_days > 0 && (
                            <Text type="secondary" style={{ display: "block", marginTop: 8 }}>{t("{amount} to pay within 7 days", { amount: money(data.treasury.due_7_days) })}</Text>
                        )}
                    </Card>
                </Col>
            </Row>

            <Divider titlePlacement="start">{t("Orders")}</Divider>
            <Row gutter={[16, 16]}>
                <Col xs={12} md={8} xl={4}><Kpi loading={loading} title={t("Orders taken")} value={formatNumber(o?.created, locale)} sub={money(o?.created_value)} /></Col>
                <Col xs={12} md={8} xl={4}><Kpi loading={loading} title={t("Confirmed")} value={formatNumber(o?.confirmed, locale)} hint={t("Orders the customer confirmed in the period.")} /></Col>
                <Col xs={12} md={8} xl={4}><Kpi loading={loading} title={t("Delivered")} value={formatNumber(o?.delivered, locale)} /></Col>
                <Col xs={12} md={8} xl={4}><Kpi loading={loading} title={t("Delivery rate")} value={deliveryRate === null ? "—" : `${deliveryRate}%`} hint={t("Delivered out of the parcels that finished (delivered or returned) in the period.")} color={deliveryRate !== null && deliveryRate < 70 ? "#cf1322" : undefined} /></Col>
                <Col xs={12} md={8} xl={4}><Kpi loading={loading} title={t("Return rate")} value={returnRate === null ? "—" : `${returnRate}%`} color={returnRate !== null && returnRate > 20 ? "#cf1322" : undefined} sub={t("{count} returned", { count: o?.returned ?? 0 })} /></Col>
                <Col xs={12} md={8} xl={4}><Kpi loading={loading} title={t("Ad cost per delivered sale")} value={m?.cost_per_delivered_sale == null ? "—" : money(m.cost_per_delivered_sale, 1)} sub={t("{amount} spent on ads", { amount: money(m?.ad_spend) })} /></Col>
            </Row>
            <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
                {t("Right now: {pending} order(s) to confirm, {moving} in delivery.", { pending: o?.pending_now ?? 0, moving: o?.in_delivery_now ?? 0 })}{" "}
                <Link href="/admin/orders">{t("Open orders")}</Link>
            </Text>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={12}>
                    <Card title={t("Delivered sales per day")}>
                        <BarChart data={days.map((d) => ({ label: d.label, value: Number(d.revenue), tooltip: `${d.label}: ${money(d.revenue)} · ${d.delivered} ${t("delivered")}` }))} emptyText={t("No delivered sales in this period.")} />
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card title={t("Orders taken per day")}>
                        <BarChart data={days.map((d) => ({ label: d.label, value: d.created, tooltip: `${d.label}: ${d.created} ${t("taken")} · ${d.confirmed} ${t("confirmed")} · ${d.returned} ${t("returned")}` }))} emptyText={t("No orders in this period.")} />
                    </Card>
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={10}>
                    <Card title={t("Sales by channel")} style={{ height: "100%" }}>
                        <BarList
                            format={(n) => money(n)}
                            rows={(data?.channels ?? []).sort((a, b) => b.revenue - a.revenue).map((c) => {
                                const done = c.delivered + c.returned;
                                return {
                                    key: c.channel,
                                    label: <ChannelTag channel={c.channel} />,
                                    value: Number(c.revenue),
                                    sub: t("{created} taken · {confirmed} confirmed · {delivered} delivered · delivery rate {rate}", {
                                        created: c.created, confirmed: c.confirmed, delivered: c.delivered,
                                        rate: done ? `${Math.round((c.delivered / done) * 100)}%` : "—",
                                    }),
                                };
                            })}
                        />
                    </Card>
                </Col>
                <Col xs={24} lg={14}>
                    <Card title={t("Best products (delivered)")} style={{ height: "100%" }} extra={<Link href="/admin/purchasing/materials?tab=costs">{t("Cost prices")}</Link>}>
                        <Table
                            size="small"
                            rowKey="product_id"
                            pagination={false}
                            loading={loading}
                            dataSource={data?.products ?? []}
                            scroll={{ x: "max-content" }}
                            columns={[
                                { title: t("Product"), dataIndex: "name", render: (v: string, r) => <span>{v} {r.missing_cost && <Tag color="orange">{t("No cost")}</Tag>}</span> },
                                { title: t("Qty"), dataIndex: "quantity", align: "right" },
                                { title: t("Sales"), dataIndex: "revenue", align: "right", render: (v: number) => money(v) },
                                { title: t("Margin"), dataIndex: "margin", align: "right", render: (v: number, r) => <span style={{ color: v < 0 ? "#cf1322" : undefined }}>{money(v)} {r.revenue > 0 && <Text type="secondary" style={{ fontSize: 12 }}>({Math.round((v / (r.revenue / (1 + (m?.vat_rate ?? 0) / 100))) * 100)}%)</Text>}</span> },
                            ]}
                        />
                    </Card>
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} xl={14}>
                    <Card title={t("Agents this period")} extra={<Link href="/admin/goals">{t("Objectives & commissions")}</Link>}>
                        <Table
                            size="small"
                            rowKey="agent_id"
                            pagination={false}
                            loading={loading}
                            dataSource={data?.agents ?? []}
                            scroll={{ x: "max-content" }}
                            locale={{ emptyText: t("No agent orders in this period.") }}
                            columns={[
                                { title: t("Agent"), dataIndex: "email", render: (v: string | null) => v ?? t("Former team member") },
                                { title: t("Taken"), dataIndex: "created", render: (v: number, r) => <TargetBar value={v} target={goalOf(r.agent_id)?.target_orders} /> },
                                { title: t("Confirmed"), dataIndex: "confirmed", render: (v: number, r) => <TargetBar value={v} target={goalOf(r.agent_id)?.target_confirmed} /> },
                                { title: t("Delivered"), dataIndex: "delivered", render: (v: number, r) => <TargetBar value={v} target={goalOf(r.agent_id)?.target_delivered} /> },
                                { title: t("Delivered sales"), dataIndex: "delivered_revenue", render: (v: number, r) => <TargetBar value={Number(v)} target={goalOf(r.agent_id)?.target_revenue} format={(n) => money(n)} /> },
                                { title: t("Returned"), dataIndex: "returned", align: "right" },
                            ]}
                        />
                        <Text type="secondary" style={{ fontSize: 12 }}>{t("Bars compare with this month's objectives.")}</Text>
                    </Card>
                </Col>
                <Col xs={24} xl={10}>
                    <Card title={t("Campaigns")} extra={<Link href="/admin/marketing/campaigns">{t("Campaigns & ad spend")}</Link>}>
                        <Table
                            size="small"
                            rowKey="campaign_id"
                            pagination={false}
                            loading={loading}
                            dataSource={(data?.campaigns ?? []).filter((c) => c.spend > 0 || c.orders > 0)}
                            scroll={{ x: "max-content" }}
                            locale={{ emptyText: t("No campaign spend or orders in this period.") }}
                            columns={[
                                { title: t("Campaign"), dataIndex: "name" },
                                { title: t("Spent"), dataIndex: "spend", align: "right", render: (v: number) => money(v) },
                                { title: t("Delivered"), dataIndex: "delivered", align: "right" },
                                { title: t("Cost per delivered sale"), key: "cpa", align: "right", render: (_, r) => (r.delivered ? money(r.spend / r.delivered, 1) : "—") },
                                { title: t("Return on ad spend"), key: "roas", align: "right", render: (_, r) => (r.spend ? `×${(r.revenue / r.spend).toFixed(1)}` : "—") },
                            ]}
                        />
                    </Card>
                </Col>
            </Row>

            <Divider titlePlacement="start">{t("Stock")}</Divider>
            <Row gutter={[16, 16]}>
                <Col xs={12} lg={6}><Kpi loading={loading} title={t("Stock value")} value={money(data?.stock.value)} hint={t("Units in stock at their weighted average cost.")} sub={t("{count} unit(s)", { count: formatNumber(data?.stock.units, locale) })} /></Col>
                <Col xs={12} lg={6}><Kpi loading={loading} title={t("Raw materials value")} value={money(data?.stock.materials_value)} /></Col>
                <Col xs={12} lg={6}><Kpi loading={loading} title={t("Low stock")} value={formatNumber(data?.stock.low, locale)} sub={<Link href="/admin/stock">{t("Inventory")}</Link>} color={data && data.stock.low > 0 ? "#d48806" : undefined} /></Col>
                <Col xs={12} lg={6}><Kpi loading={loading} title={t("Out of stock")} value={formatNumber(data?.stock.out, locale)} color={data && data.stock.out > 0 ? "#cf1322" : undefined} sub={t("Sold as made to order")} /></Col>
            </Row>
        </div>
    );
}

function PnlLine({ label, value, money, strong, border, sub }: { label: string; value: number | undefined; money: (n: number | undefined) => string; strong?: boolean; border?: boolean; sub?: string }) {
    const n = Number(value ?? 0);
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderTop: border ? "1px solid #f0f0f0" : undefined, fontWeight: strong ? 600 : 400 }}>
            <div>
                <div>{label}</div>
                {sub && <div style={{ fontSize: 12, color: "#8c8c8c", fontWeight: 400 }}>{sub}</div>}
            </div>
            <div style={{ fontVariantNumeric: "tabular-nums", color: n < 0 ? "#cf1322" : undefined, whiteSpace: "nowrap" }}>{value === undefined ? "—" : money(n)}</div>
        </div>
    );
}
