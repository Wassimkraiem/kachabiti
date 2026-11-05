"use client";

import Link from "next/link";
import { Alert, Badge, Button, Card, Col, Empty, Row, Space, Tag, Typography } from "antd";
import { CheckOutlined, MessageOutlined, PhoneOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { useAdminRole } from "@/lib/admin-role-context";
import { ChannelTag, Kpi, ListRow, PageHeader } from "@/components/admin/erp/ui";
import { TargetBar } from "@/components/admin/erp/charts";
import { api, day, formatDate, formatMoney, useApi } from "@/components/admin/erp/erp-client";
import MonthGoalCard, { type MonthGoal } from "@/components/admin/erp/MonthGoalCard";
import { ORDER_STATUS_COLORS, orderStatusLabel } from "@/components/admin/order-status";

const { Text } = Typography;

interface OrderRow {
    id: string;
    order_number: string;
    status: string;
    total: number;
    channel: string;
    created_at: string;
    customer_first_name: string;
    customer_last_name: string;
    customer_phone: string;
    shipping_city: string | null;
}

interface MyWork {
    to_confirm: OrderRow[];
    in_delivery: OrderRow[];
    unassigned_count: number;
    tickets: { id: string; title: string; priority: string; due_date: string | null }[];
    tasks: { id: string; title: string; notes: string | null; due_at: string; customer: { id: string; full_name: string; phone: string | null } | null; order: { id: string; order_number: string } | null }[];
    unread_customers: number;
    month: {
        created: number; confirmed: number; delivered: number; delivered_revenue: number; commission: number;
        tier: { orders: number; prize: number } | null;
        next_tier: { orders: number; prize: number } | null;
        orders_to_next: number | null;
        goal: { target_orders: number | null; target_confirmed: number | null; target_delivered: number | null; target_revenue: number | null; commission_type: string; prize_tiers?: { orders: number; prize: number }[] } | null;
    } | null;
    team: MonthGoal | null;
}

/**
 * Admin → My day: what the signed-in agent has to do now. Their orders to confirm (call the
 * customer, then Confirm), their parcels on the way, follow-ups due, unread customer messages,
 * and this month's results against their objective.
 */
export default function MyWorkPage() {
    const { t, locale } = useAdminT();
    const { can } = useAdminRole();
    const { data, loading, error, reload } = useApi<MyWork>("/api/admin/my-work");
    const money = (n: number) => formatMoney(n, locale, 0);
    const now = Date.now();

    const confirm = async (id: string) => {
        try {
            await api("/api/sales/orders", { method: "PATCH", body: { action: "confirm", ids: [id] } });
            message.success(t("Order confirmed"));
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };
    const done = async (id: string) => {
        try {
            await api("/api/crm/tasks", { method: "PUT", body: { id, done: true } });
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const ticketDone = async (id: string) => {
        try {
            await api("/api/admin/tickets", { method: "PUT", body: { id, status: "done" } });
            reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const goal = data?.month?.goal;
    const today = day(new Date());

    return (
        <div>
            <PageHeader
                title={t("My day")}
                subtitle={t("Your tasks, orders, follow-ups and messages, and how your month is going.")}
                extra={
                    <>
                        <Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>{t("Refresh")}</Button>
                        {can("orders") && <Link href="/admin/orders/new"><Button type="primary" icon={<PlusOutlined />}>{t("New order")}</Button></Link>}
                    </>
                }
            />
            {error && <Alert type="error" showIcon title={t(error)} style={{ marginBottom: 16 }} />}

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={12} md={6}><Kpi loading={loading} title={t("Taken this month")} value={data?.month?.created ?? 0} sub={goal?.target_orders ? <TargetBar value={data?.month?.created ?? 0} target={goal.target_orders} /> : undefined} /></Col>
                <Col xs={12} md={6}><Kpi loading={loading} title={t("Confirmed this month")} value={data?.month?.confirmed ?? 0} sub={goal?.target_confirmed ? <TargetBar value={data?.month?.confirmed ?? 0} target={goal.target_confirmed} /> : undefined} /></Col>
                <Col xs={12} md={6}><Kpi loading={loading} title={t("Delivered this month")} value={data?.month?.delivered ?? 0} sub={goal?.target_delivered ? <TargetBar value={data?.month?.delivered ?? 0} target={goal.target_delivered} /> : money(data?.month?.delivered_revenue ?? 0)} /></Col>
                <Col xs={12} md={6}><Kpi loading={loading} title={goal && goal.commission_type !== "none" ? t("Commission so far") : t("Delivered sales")} value={goal && goal.commission_type !== "none" ? money(data?.month?.commission ?? 0) : money(data?.month?.delivered_revenue ?? 0)} sub={goal?.target_revenue ? <TargetBar value={data?.month?.delivered_revenue ?? 0} target={goal.target_revenue} format={money} /> : undefined} /></Col>
            </Row>

            {goal?.commission_type === "tiers" && data?.month && (
                <Alert
                    type={data.month.next_tier ? "info" : "success"}
                    showIcon
                    style={{ marginBottom: 16 }}
                    title={data.month.next_tier
                        ? t("{count} more delivered orders this month for a prize of {amount}.", { count: data.month.orders_to_next ?? 0, amount: money(data.month.next_tier.prize) })
                        : t("You reached the top prize of the month!")}
                    description={(goal.prize_tiers ?? []).map((tier) => `${tier.orders} → ${money(tier.prize)}`).join(" · ")}
                />
            )}

            {data?.team && <MonthGoalCard goal={data.team} money={money} />}


            {data && data.unassigned_count > 0 && (
                <Alert
                    style={{ marginBottom: 16 }}
                    type="info"
                    showIcon
                    title={t("{count} website order(s) are not handled by anyone yet.", { count: data.unassigned_count })}
                    action={<Link href="/admin/orders?assigned=none"><Button size="small">{t("Take some")}</Button></Link>}
                />
            )}

            <Row gutter={[16, 16]}>
                <Col xs={24}>
                    <Card
                        title={<span>{t("My tasks")} <Badge count={data?.tickets.length ?? 0} /></span>}
                        loading={loading}
                        extra={<Link href="/admin/tickets">{t("Team tasks")}</Link>}
                    >
                        {!data?.tickets.length ? <Empty description={t("No tasks for you.")} /> : (
                            <div>
                                {data.tickets.map((ticket) => {
                                    const late = !!ticket.due_date && ticket.due_date < today;
                                    return (
                                        <ListRow
                                            key={ticket.id}
                                            actions={[<Button key="done" size="small" icon={<CheckOutlined />} onClick={() => ticketDone(ticket.id)}>{t("Done")}</Button>]}
                                            title={<Link href={`/admin/tickets?id=${ticket.id}`}>{ticket.title}</Link>}
                                            description={
                                                <Space size={4} wrap>
                                                    {ticket.priority === "high" && <Tag color="red">{t("High")}</Tag>}
                                                    {ticket.due_date && <Text type={late ? "danger" : "secondary"}>{late ? `${t("Overdue")} · ` : ""}{formatDate(ticket.due_date, locale)}</Text>}
                                                </Space>
                                            }
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </Card>
                </Col>
                {can("orders") && (
                    <Col xs={24} lg={12}>
                        <Card title={<span>{t("To confirm")} <Badge count={data?.to_confirm.length ?? 0} style={{ background: "#fa8c16" }} /></span>} loading={loading}>
                            {!data?.to_confirm.length ? <Empty description={t("Nothing to confirm. Well done!")} /> : (
                                <div>
                                    {data.to_confirm.map((o) => {
                                        const hours = Math.floor((now - new Date(o.created_at).getTime()) / 3_600_000);
                                        return (
                                            <ListRow
                                                key={o.id}
                                                actions={[
                                                    <a key="call" href={`tel:${o.customer_phone}`} aria-label={t("Call")}><PhoneOutlined /></a>,
                                                    o.status === "pending" ? <Button key="ok" size="small" icon={<CheckOutlined />} onClick={() => confirm(o.id)}>{t("Confirm")}</Button> : <Tag key="ok" color="gold">{t("Confirmed")}</Tag>,
                                                ]}
                                                title={<Link href={`/admin/orders/${o.id}`}>{o.customer_first_name} {o.customer_last_name}</Link>}
                                                description={
                                                    <Space size={4} wrap>
                                                        <span>{o.customer_phone}</span>
                                                        {o.shipping_city && <span>· {o.shipping_city}</span>}
                                                        <span>· {money(o.total)}</span>
                                                        <ChannelTag channel={o.channel} />
                                                        <Text type={hours >= 24 ? "danger" : "secondary"} style={{ fontSize: 12 }}>{t("{hours} h ago", { hours })}</Text>
                                                    </Space>
                                                }
                                            />
                                        );
                                    })}
                                </div>
                            )}
                        </Card>
                    </Col>
                )}
                {can("customers") && (
                    <Col xs={24} lg={12}>
                        <Card
                            title={<span>{t("Follow-ups")} <Badge count={data?.tasks.length ?? 0} /></span>}
                            loading={loading}
                            extra={data && data.unread_customers > 0 ? <Link href="/admin/customers/inbox"><MessageOutlined /> {t("{count} unread conversation(s)", { count: data.unread_customers })}</Link> : null}
                        >
                            {!data?.tasks.length ? <Empty description={t("No follow-ups due.")} /> : (
                                <div>
                                    {data.tasks.map((task) => {
                                        const late = new Date(task.due_at).getTime() < now;
                                        return (
                                            <ListRow
                                                key={task.id}
                                                actions={[<Button key="done" size="small" icon={<CheckOutlined />} onClick={() => done(task.id)}>{t("Done")}</Button>]}
                                                title={task.title}
                                                description={
                                                    <Space size={4} wrap>
                                                        <Text type={late ? "danger" : "secondary"}>{formatDate(task.due_at, locale, true)}</Text>
                                                        {task.customer && <Link href={`/admin/customers/${task.customer.id}`}>· {task.customer.full_name || task.customer.phone}</Link>}
                                                        {task.order && <Link href={`/admin/orders/${task.order.id}`}>· {task.order.order_number}</Link>}
                                                    </Space>
                                                }
                                            />
                                        );
                                    })}
                                </div>
                            )}
                        </Card>
                    </Col>
                )}
                {can("orders") && (
                    <Col xs={24}>
                        <Card title={t("My parcels on the way")} loading={loading}>
                            {!data?.in_delivery.length ? <Empty description={t("No parcels on the way.")} /> : (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                                    {data.in_delivery.map((o) => (
                                        <Card key={o.id} size="small">
                                            <Link href={`/admin/orders/${o.id}`}>{o.customer_first_name} {o.customer_last_name}</Link>
                                            <div><Tag color={ORDER_STATUS_COLORS[o.status]}>{t(orderStatusLabel(o.status))}</Tag> {money(o.total)}</div>
                                            <Text type="secondary" style={{ fontSize: 12 }}>{formatDate(o.created_at, locale)}</Text>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </Card>
                    </Col>
                )}
            </Row>
        </div>
    );
}
