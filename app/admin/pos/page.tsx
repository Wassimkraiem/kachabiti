"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, Col, Empty, Form, Image, Input, InputNumber, Modal, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
import { DeleteOutlined, LockOutlined, MinusOutlined, PlusOutlined, PrinterOutlined, SearchOutlined, SwapOutlined, UnlockOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { useAdminRole } from "@/lib/admin-role-context";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/erp/constants";
import { PageHeader } from "@/components/admin/erp/ui";
import { api, formatDate, formatMoney, useApi } from "@/components/admin/erp/erp-client";
import { ORDER_ITEM_IMAGE_FALLBACK } from "@/components/admin/order-status";
import { isLowStock, isOutOfStock, PosStockTab, type ShopStockRow } from "@/components/admin/pos/PosStockTab";
import { PosAnalyticsTab } from "@/components/admin/pos/PosAnalyticsTab";

const { Text, Title } = Typography;

interface Location { id: string; name: string; sells_online: boolean }
interface Session { id: string; number: string; location_id: string; opened_at: string; opened_by_email: string | null; opening_float: number; location: { id: string; name: string } }
interface Overview { open_sessions: Session[]; locations: Location[]; settings: { max_discount_percent?: number } }
interface Sellable extends ShopStockRow { base_price: number; discount_percent: number; image: string | null; tracked: boolean }
interface CartLine extends Sellable { key: string; quantity: number }
interface SessionSummary {
    session: Session & { status: string };
    sales: { id: string; order_number: string; total: number; created_at: string; customer_first_name: string; status: string }[];
    movements: { id: string; direction: string; amount: number; label: string; created_at: string }[];
    totals: { sales: number; count: number; discounts: number; by_method: Record<string, number>; expected_cash: number };
}

const TILL_METHODS: PaymentMethod[] = ["cash", "card", "bank_transfer", "check", "mobile"];
const LOCATION_KEY = "pos_location";

/**
 * Admin → Point of sale. Open the till with its starting cash, sell (search, tap to add, discount
 * within the allowed limit, pay by cash/card/transfer/cheque or split), print the receipt, record
 * cash in and out, and close by counting the drawer. Sales use the same products, prices and stock
 * rules as the website; stock leaves the shop's location.
 */
export default function PosPage() {
    const { t, locale } = useAdminT();
    const { isAdmin, can } = useAdminRole();
    const overview = useApi<Overview>("/api/pos");
    const [tab, setTab] = useState("sell");
    const [locationId, setLocationId] = useState<string | null>(null);
    const session = useMemo(() => overview.data?.open_sessions.find((s) => s.location_id === locationId) ?? null, [overview.data, locationId]);
    // By shop, not session: the Stock tab works with the till closed.
    const catalog = useApi<Sellable[]>(locationId ? `/api/pos?catalog=1&location_id=${locationId}` : null);
    const summary = useApi<SessionSummary>(session ? `/api/pos?session_id=${session.id}` : null);
    const [search, setSearch] = useState("");
    const [cart, setCart] = useState<CartLine[]>([]);
    const [discount, setDiscount] = useState<number>(0);
    const [discountMode, setDiscountMode] = useState<"amount" | "percent">("amount");
    const [customer, setCustomer] = useState({ name: "", phone: "" });
    const [payments, setPayments] = useState<{ method: PaymentMethod; amount: number | null }[]>([{ method: "cash", amount: null }]);
    const [selling, setSelling] = useState(false);
    const [done, setDone] = useState<{ id: string; order_number: string; change: number } | null>(null);
    const [openForm] = Form.useForm();
    const [cashOpen, setCashOpen] = useState<"in" | "out" | null>(null);
    const [cashForm] = Form.useForm();
    const [closing, setClosing] = useState(false);
    const [counted, setCounted] = useState<number | null>(null);

    // Remember the shop this browser sells from; a low-stock alert opens ?tab=stock&location=.
    // shortcut: read once on load, so an alert clicked while already on this page changes nothing; use useSearchParams with a Suspense boundary if that matters.
    useEffect(() => {
        if (!overview.data || locationId) return;
        const query = new URLSearchParams(window.location.search);
        if (query.get("tab") === "stock") setTab("stock");
        let saved = query.get("location");
        try {
            saved ??= localStorage.getItem(LOCATION_KEY);
        } catch {
            // storage unavailable
        }
        const shops = overview.data.locations;
        const pick = shops.find((l) => l.id === saved) ?? overview.data.open_sessions[0]?.location ?? shops.find((l) => !l.sells_online) ?? shops[0];
        if (pick) setLocationId(pick.id);
    }, [overview.data, locationId]);
    const chooseLocation = (id: string) => {
        setLocationId(id);
        try {
            localStorage.setItem(LOCATION_KEY, id);
        } catch {
            // storage unavailable
        }
    };

    const money = (n: number) => formatMoney(n, locale);
    const subtotal = cart.reduce((s, l) => s + l.price * l.quantity, 0);
    const discountAmount = Math.min(subtotal, discountMode === "percent" ? Math.round(subtotal * (discount || 0) * 10) / 1000 : discount || 0);
    const total = Math.max(0, Math.round((subtotal - discountAmount) * 1000) / 1000);
    const maxPercent = overview.data?.settings.max_discount_percent ?? 10;
    const overLimit = !isAdmin && subtotal > 0 && discountAmount > (subtotal * maxPercent) / 100 + 0.0005;
    const paid = payments.reduce((s, p) => s + (p.amount ?? (payments.length === 1 ? total : 0)), 0);
    const change = Math.max(0, paid - total);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        const rows = catalog.data ?? [];
        if (!term) return rows.slice(0, 60);
        return rows.filter((r) => [r.name, r.label, r.sku, r.code].some((v) => (v ?? "").toLowerCase().includes(term))).slice(0, 60);
    }, [catalog.data, search]);

    const add = (item: Sellable) => {
        const key = `${item.product_id}:${item.variant_id ?? ""}`;
        setCart((lines) => {
            const found = lines.find((l) => l.key === key);
            return found ? lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l)) : [...lines, { ...item, key, quantity: 1 }];
        });
    };
    const setQty = (key: string, quantity: number) => setCart((lines) => (quantity <= 0 ? lines.filter((l) => l.key !== key) : lines.map((l) => (l.key === key ? { ...l, quantity } : l))));

    const reset = () => {
        setCart([]);
        setDiscount(0);
        setCustomer({ name: "", phone: "" });
        setPayments([{ method: "cash", amount: null }]);
    };

    const sell = async () => {
        if (!session || !cart.length) return;
        setSelling(true);
        try {
            const result = await api<{ order: { id: string; order_number: string }; change: number }>("/api/pos", {
                method: "POST",
                body: {
                    action: "sale",
                    session_id: session.id,
                    items: cart.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity })),
                    discount_amount: discountAmount,
                    customer: { name: customer.name, phone: customer.phone.replace(/\D/g, "") },
                    payments: payments.map((p) => ({ method: p.method, amount: p.amount ?? (payments.length === 1 ? total : 0) })).filter((p) => p.amount > 0),
                },
            });
            setDone({ id: result.order.id, order_number: result.order.order_number, change: result.change });
            reset();
            summary.reload();
            catalog.reload();
        } catch (e) {
            message.error(t((e as Error).message));
        } finally {
            setSelling(false);
        }
    };

    const openTill = async () => {
        const values = await openForm.validateFields();
        try {
            await api("/api/pos", { method: "POST", body: { action: "open", location_id: locationId, opening_float: values.opening_float ?? 0 } });
            message.success(t("Till opened"));
            overview.reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const recordCash = async () => {
        const values = await cashForm.validateFields();
        try {
            await api("/api/pos", { method: "POST", body: { action: "cash", session_id: session!.id, direction: cashOpen, amount: values.amount, label: values.label } });
            setCashOpen(null);
            cashForm.resetFields();
            summary.reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const closeTill = async () => {
        if (counted === null) return;
        try {
            const closed = await api<{ difference: number }>("/api/pos", { method: "POST", body: { action: "close", session_id: session!.id, counted_cash: counted } });
            if (Math.abs(closed.difference) > 0.0005) message.warning(t("Till closed with a difference of {amount}", { amount: money(closed.difference) }));
            else message.success(t("Till closed. The cash matches."));
            setClosing(false);
            setCounted(null);
            overview.reload();
        } catch (e) {
            message.error(t((e as Error).message));
        }
    };

    const locations = overview.data?.locations ?? [];
    const lowCount = (catalog.data ?? []).filter((r) => isLowStock(r) || isOutOfStock(r)).length;

    return (
        <div>
            <PageHeader
                title={t("Point of sale")}
                subtitle={session ? t("Till {number} open since {date} · {who}", { number: session.number, date: formatDate(session.opened_at, locale, true), who: session.opened_by_email ?? "" }) : t("Sell in the shop with the same products, prices and stock as the website.")}
                extra={
                    <>
                        <Select value={locationId ?? undefined} onChange={chooseLocation} style={{ minWidth: 180 }} options={locations.map((l) => ({ value: l.id, label: l.name }))} placeholder={t("Shop")} />
                        {session && (
                            <>
                                <Button icon={<SwapOutlined />} onClick={() => setCashOpen("in")}>{t("Cash in")}</Button>
                                <Button icon={<SwapOutlined />} onClick={() => setCashOpen("out")}>{t("Cash out")}</Button>
                                <Button danger icon={<LockOutlined />} onClick={() => setClosing(true)}>{t("Close till")}</Button>
                            </>
                        )}
                        <Link href="/admin/pos/sessions"><Button>{t("Till sessions")}</Button></Link>
                    </>
                }
            />

            {overview.data && !locations.length && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={t("No shop yet. Mark a location as a shop in Stock settings to use the caisse.")} />}

            <Tabs
                activeKey={tab}
                onChange={setTab}
                items={[
                    { key: "sell", label: t("Sell") },
                    { key: "stock", label: <Badge count={lowCount} offset={[12, 0]} size="small">{t("Stock")}</Badge> },
                    ...(can("analytics") || can("finance") ? [{ key: "analytics", label: t("Analytics") }] : []),
                ]}
            />

            {tab === "stock" && <PosStockTab rows={catalog.data ?? []} loading={catalog.loading} shop={locations.find((l) => l.id === locationId)?.name} onReload={catalog.reload} />}
            {tab === "analytics" && <PosAnalyticsTab shops={locations} />}

            {tab === "sell" && (!session ? (
                <Card style={{ maxWidth: 480 }} loading={overview.loading}>
                    <Title level={4} style={{ marginTop: 0 }}><UnlockOutlined /> {t("Open the till")}</Title>
                    {locations.find((l) => l.id === locationId)?.sells_online && (
                        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={t("This location sells online. Add a shop location in Stock settings so till sales don't use the website's stock.")} />
                    )}
                    <Form form={openForm} layout="vertical" initialValues={{ opening_float: 0 }}>
                        <Form.Item name="opening_float" label={t("Cash in the drawer to start (float)")} rules={[{ required: true }]}>
                            <InputNumber min={0} precision={3} style={{ width: "100%" }} suffix="TND" size="large" />
                        </Form.Item>
                        <Button type="primary" size="large" block onClick={openTill} disabled={!locationId}>{t("Open the till")}</Button>
                    </Form>
                </Card>
            ) : (
                <Row gutter={[16, 16]}>
                    <Col xs={24} lg={14}>
                        <Card>
                            <Input
                                size="large"
                                allowClear
                                autoFocus
                                prefix={<SearchOutlined />}
                                placeholder={t("Search product, size, colour or code")}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onPressEnter={() => filtered.length === 1 && add(filtered[0])}
                                style={{ marginBottom: 12 }}
                            />
                            {catalog.loading ? <Card loading /> : !filtered.length ? <Empty description={t("No products found")} /> : (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
                                    {filtered.map((item) => (
                                        <button
                                            key={`${item.product_id}:${item.variant_id}`}
                                            type="button"
                                            onClick={() => add(item)}
                                            style={{ textAlign: "start", border: "1px solid #eee", borderRadius: 10, padding: 8, background: "#fff", cursor: "pointer" }}
                                        >
                                            <Image src={item.image || undefined} fallback={ORDER_ITEM_IMAGE_FALLBACK} preview={false} width="100%" height={110} style={{ objectFit: "cover", objectPosition: "top", borderRadius: 6 }} alt={item.name} />
                                            <div style={{ fontWeight: 500, fontSize: 13, marginTop: 6, lineHeight: 1.2 }}>{item.name}</div>
                                            {item.label && <div style={{ fontSize: 12, color: "#8c8c8c" }}>{item.label}</div>}
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                                                <span style={{ fontWeight: 600 }}>{formatMoney(item.price, locale, 0)}</span>
                                                {item.stock !== null && <Tag color={item.stock > 0 && !isLowStock(item) ? "green" : "orange"} style={{ marginInlineEnd: 0 }}>{item.stock > 0 ? item.stock : t("Made to order")}</Tag>}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </Card>
                    </Col>

                    <Col xs={24} lg={10}>
                        <Card title={<span>{t("Sale")} <Badge count={cart.reduce((s, l) => s + l.quantity, 0)} /></span>} extra={cart.length > 0 && <Button size="small" type="text" danger onClick={reset}>{t("Clear")}</Button>}>
                            {!cart.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("Tap a product to add it.")} /> : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    {cart.map((l) => (
                                        <div key={l.key} style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #f5f5f5", paddingBottom: 8 }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: 500 }}>{l.name}</div>
                                                <Text type="secondary" style={{ fontSize: 12 }}>{l.label} {l.label && "·"} {money(l.price)}</Text>
                                            </div>
                                            <Space.Compact>
                                                <Button size="small" icon={<MinusOutlined />} onClick={() => setQty(l.key, l.quantity - 1)} aria-label={t("Less")} />
                                                <InputNumber size="small" min={1} value={l.quantity} onChange={(v) => setQty(l.key, Number(v) || 1)} style={{ width: 52 }} />
                                                <Button size="small" icon={<PlusOutlined />} onClick={() => setQty(l.key, l.quantity + 1)} aria-label={t("More")} />
                                            </Space.Compact>
                                            <span style={{ width: 90, textAlign: "end", fontVariantNumeric: "tabular-nums" }}>{money(l.price * l.quantity)}</span>
                                            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setQty(l.key, 0)} aria-label={t("Remove")} />
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                <Text>{t("Discount")}</Text>
                                <Space.Compact>
                                    <InputNumber min={0} value={discount} onChange={(v) => setDiscount(Number(v) || 0)} style={{ width: 110 }} />
                                    <Select value={discountMode} onChange={setDiscountMode} style={{ width: 80 }} options={[{ value: "amount", label: "TND" }, { value: "percent", label: "%" }]} />
                                </Space.Compact>
                                {overLimit && <Text type="danger" style={{ fontSize: 12 }}>{t("Above {percent}%: needs an owner or admin.", { percent: maxPercent })}</Text>}
                            </div>
                            <Space style={{ marginTop: 8 }} wrap>
                                <Input placeholder={t("Customer name (optional)")} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} style={{ width: 190 }} />
                                <Input placeholder={t("Phone (optional)")} inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} style={{ width: 150 }} />
                            </Space>

                            <div style={{ marginTop: 16, padding: 12, background: "#fafafa", borderRadius: 8 }}>
                                <div style={{ display: "flex", justifyContent: "space-between" }}><span>{t("Subtotal")}</span><span>{money(subtotal)}</span></div>
                                {discountAmount > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>{t("Discount")}</span><span>− {money(discountAmount)}</span></div>}
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, fontWeight: 700, marginTop: 4 }}><span>{t("Total")}</span><span>{money(total)}</span></div>
                            </div>

                            <div style={{ marginTop: 12 }}>
                                {payments.map((p, i) => (
                                    <Space key={i} style={{ display: "flex", marginBottom: 8 }} wrap>
                                        <Select
                                            value={p.method}
                                            onChange={(method: PaymentMethod) => setPayments((list) => list.map((x, j) => (j === i ? { ...x, method } : x)))}
                                            options={TILL_METHODS.map((m) => ({ value: m, label: t(PAYMENT_METHOD_LABELS[m]) }))}
                                            style={{ width: 150 }}
                                        />
                                        <InputNumber
                                            placeholder={payments.length === 1 ? money(total) : t("Amount")}
                                            min={0}
                                            precision={3}
                                            value={p.amount}
                                            onChange={(v) => setPayments((list) => list.map((x, j) => (j === i ? { ...x, amount: v === null ? null : Number(v) } : x)))}
                                            style={{ width: 140 }}
                                            suffix="TND"
                                        />
                                        {payments.length > 1 && <Button size="small" type="text" icon={<DeleteOutlined />} onClick={() => setPayments((list) => list.filter((_, j) => j !== i))} aria-label={t("Remove")} />}
                                    </Space>
                                ))}
                                <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => setPayments((list) => [...list, { method: "card", amount: Math.max(0, total - paid) || null }])}>{t("Split payment")}</Button>
                                {change > 0 && <div style={{ marginTop: 8, fontSize: 16 }}>{t("Change to give")}: <b>{money(change)}</b></div>}
                                {paid < total - 0.0005 && cart.length > 0 && <div style={{ marginTop: 8 }}><Text type="danger">{t("Still to pay: {amount}", { amount: money(total - paid) })}</Text></div>}
                            </div>

                            <Button type="primary" size="large" block style={{ marginTop: 16, height: 52, fontSize: 18 }} disabled={!cart.length || paid < total - 0.0005 || overLimit} loading={selling} onClick={sell}>
                                {t("Complete sale · {amount}", { amount: money(total) })}
                            </Button>
                        </Card>

                        <Card size="small" style={{ marginTop: 16 }} title={t("This session")} loading={summary.loading}>
                            <Row gutter={8}>
                                <Col span={8}><Statistic title={t("Sales")} value={summary.data?.totals.count ?? 0} styles={{ content: { fontSize: 16 } }} /></Col>
                                <Col span={8}><Statistic title={t("Total")} value={formatMoney(summary.data?.totals.sales ?? 0, locale, 0)} styles={{ content: { fontSize: 16 } }} /></Col>
                                <Col span={8}><Statistic title={t("Cash expected")} value={formatMoney(summary.data?.totals.expected_cash ?? 0, locale, 0)} styles={{ content: { fontSize: 16 } }} /></Col>
                            </Row>
                            {summary.data && (
                                <Table
                                    size="small"
                                    style={{ marginTop: 8 }}
                                    rowKey="id"
                                    pagination={{ pageSize: 5, hideOnSinglePage: true }}
                                    dataSource={summary.data.sales}
                                    columns={[
                                        { title: t("Time"), dataIndex: "created_at", render: (v: string) => new Date(v).toLocaleTimeString(locale === "ar" ? "ar-TN" : locale, { hour: "2-digit", minute: "2-digit" }) },
                                        { title: t("Total"), dataIndex: "total", render: (v: number) => money(v) },
                                        { title: "", key: "p", render: (_, r) => <Link href={`/admin/pos/receipt/${r.id}`} target="_blank"><PrinterOutlined /></Link> },
                                    ]}
                                />
                            )}
                        </Card>
                    </Col>
                </Row>
            ))}

            <Modal open={!!done} title={t("Sale {number} done", { number: done?.order_number ?? "" })} onCancel={() => setDone(null)} footer={[
                <Button key="print" icon={<PrinterOutlined />} onClick={() => window.open(`/admin/pos/receipt/${done?.id}?print=1`, "_blank")}>{t("Print receipt")}</Button>,
                <Button key="next" type="primary" onClick={() => setDone(null)}>{t("Next customer")}</Button>,
            ]}>
                {done && done.change > 0 ? <Title level={3}>{t("Change to give")}: {money(done.change)}</Title> : <Text>{t("Paid in full.")}</Text>}
            </Modal>

            <Modal open={cashOpen !== null} title={cashOpen === "in" ? t("Cash in") : t("Cash out")} onCancel={() => setCashOpen(null)} onOk={recordCash} okText={t("Save")} cancelText={t("Cancel")} forceRender>
                <Form form={cashForm} layout="vertical">
                    <Form.Item name="amount" label={t("Amount")} rules={[{ required: true }]}><InputNumber min={0.001} precision={3} style={{ width: "100%" }} suffix="TND" /></Form.Item>
                    <Form.Item name="label" label={t("Reason")} rules={[{ required: true }]}><Input placeholder={cashOpen === "in" ? t("Change added, other income...") : t("Small purchase, bank deposit...")} /></Form.Item>
                </Form>
            </Modal>

            <Modal open={closing} title={t("Close the till")} onCancel={() => setClosing(false)} onOk={closeTill} okText={t("Close till")} okButtonProps={{ danger: true, disabled: counted === null }} cancelText={t("Cancel")} forceRender>
                {summary.data && (
                    <>
                        <p>{t("Starting cash")}: <b>{money(Number(summary.data.session.opening_float))}</b></p>
                        {Object.entries(summary.data.totals.by_method).map(([method, amount]) => (
                            <p key={method}>{t(PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method)}: <b>{money(amount)}</b></p>
                        ))}
                        <p>{t("Cash expected in the drawer")}: <b>{money(summary.data.totals.expected_cash)}</b></p>
                        <Form layout="vertical">
                            <Form.Item label={t("Cash counted in the drawer")} required>
                                <InputNumber autoFocus min={0} precision={3} value={counted} onChange={(v) => setCounted(v === null ? null : Number(v))} style={{ width: "100%" }} suffix="TND" size="large" />
                            </Form.Item>
                        </Form>
                        {counted !== null && (
                            <Alert
                                type={Math.abs(counted - summary.data.totals.expected_cash) < 0.0005 ? "success" : "warning"}
                                showIcon
                                title={Math.abs(counted - summary.data.totals.expected_cash) < 0.0005 ? t("The cash matches.") : t("Difference: {amount}", { amount: money(counted - summary.data.totals.expected_cash) })}
                            />
                        )}
                    </>
                )}
            </Modal>
        </div>
    );
}
