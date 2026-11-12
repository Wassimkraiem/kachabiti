"use client";

import type { ReactNode } from "react";
import { Col, Row } from "antd";
import {
    ArrowLeftOutlined,
    CarOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    DollarOutlined,
    ExportOutlined,
    HomeOutlined,
    QuestionOutlined,
    RollbackOutlined,
    ShoppingOutlined,
    SwapOutlined,
    SyncOutlined,
} from "@ant-design/icons";
import { msg, useAdminT } from "@/lib/admin-i18n";
import { formatMoney } from "@/components/admin/erp/erp-client";

// Calm accents in the admin's palette (brand brown #7a3b2e), one per stage family.
const ACCENT = {
    waiting: "#b7791f",
    moving: "#7a3b2e",
    check: "#b83d6b",
    delivered: "#3f8f5c",
    exchange: "#7b4f9e",
    returned: "#b23a3a",
    other: "#8c8c8c",
};

interface Card {
    key: string;
    label: string;
    statuses: string[]; // the spellings we store (Colissimo's two APIs differ for some)
    icon: ReactNode;
    accent: string;
}

/** Colissimo's dashboard, card for card: its statuses, in its order. */
export const STATUS_CARDS: Card[] = [
    { key: "waiting", label: msg("Waiting"), statuses: ["En attente", "sending"], icon: <ClockCircleOutlined />, accent: ACCENT.waiting },
    { key: "pickup", label: msg("To be picked up"), statuses: ["A enlever"], icon: <ShoppingOutlined />, accent: ACCENT.waiting },
    { key: "picked", label: msg("Picked up"), statuses: ["Enleve"], icon: <ExportOutlined />, accent: ACCENT.moving },
    { key: "depot", label: msg("At the depot"), statuses: ["Au depot", "Au magasin"], icon: <HomeOutlined />, accent: ACCENT.moving },
    { key: "return_depot", label: msg("Returned to the depot"), statuses: ["Retour depot", "Rtn depot"], icon: <HomeOutlined />, accent: ACCENT.returned },
    { key: "moving", label: msg("Out for delivery"), statuses: ["En cours"], icon: <CarOutlined />, accent: ACCENT.moving },
    { key: "check", label: msg("To be checked"), statuses: ["A verifier", "Non recu", "Inconnu"], icon: <QuestionOutlined />, accent: ACCENT.check },
    { key: "delivered", label: msg("Delivered"), statuses: ["Livre", "Livrer"], icon: <CheckCircleOutlined />, accent: ACCENT.delivered },
    { key: "paid", label: msg("Delivered and paid"), statuses: ["Livre paye"], icon: <DollarOutlined />, accent: ACCENT.delivered },
    { key: "exchange_back", label: msg("Exchanges returned"), statuses: ["Echange retourne"], icon: <RollbackOutlined />, accent: ACCENT.exchange },
    { key: "exchange", label: msg("Exchange"), statuses: ["Echange"], icon: <SwapOutlined />, accent: ACCENT.exchange },
    { key: "return_final", label: msg("Returned"), statuses: ["Retour definitif", "Rtn definitif"], icon: <ArrowLeftOutlined />, accent: ACCENT.returned },
    { key: "return_agency", label: msg("Between agencies"), statuses: ["Retour Inter Agence"], icon: <ArrowLeftOutlined />, accent: ACCENT.returned },
    { key: "return_sender", label: msg("Returning to us"), statuses: ["Retour Expediteur", "Rtn client/agence"], icon: <ArrowLeftOutlined />, accent: ACCENT.returned },
    { key: "return_paid", label: msg("Return received and paid"), statuses: ["Retour recu paye", "Retour paye", "Retour recu"], icon: <ArrowLeftOutlined />, accent: ACCENT.returned },
    { key: "return_ship", label: msg("Being returned"), statuses: ["Retour"], icon: <SyncOutlined />, accent: ACCENT.returned },
    // Not Colissimo's: old tools' parcels stuck mid-way that the account no longer lists ("All my data").
    { key: "old_unknown", label: msg("Old order, status unknown"), statuses: ["OLD-ORDERS-UNKNOWN"], icon: <QuestionOutlined />, accent: ACCENT.other },
];
const KNOWN = new Set(STATUS_CARDS.flatMap((c) => c.statuses));

/** The statuses a card shows (key "other": every status no card lists). */
export function statusesOfCard(key: string, byStatus: { status: string }[]) {
    if (key === "other") return byStatus.map((s) => s.status).filter((s) => !KNOWN.has(s));
    return STATUS_CARDS.find((c) => c.key === key)?.statuses ?? [];
}

/**
 * Admin → Delivery's status cards, laid out like Colissimo's dashboard but in the admin's style:
 * every status with its parcel count, and its cash to collect when the server sends amounts
 * (owners and admins). Click to filter the list; click again for every parcel.
 */
export default function StatusCards({ byStatus, selected, onSelect, showMoney }: {
    byStatus: { status: string; n: number; amount?: number }[];
    selected: string;
    onSelect: (key: string) => void;
    /** Owners and admins: amounts, and "Delivered and paid" (staff see those parcels as delivered). */
    showMoney: boolean;
}) {
    const { t, locale } = useAdminT();
    const total = (statuses: string[]) => byStatus.filter((s) => statuses.includes(s.status)).reduce((sum, s) => ({ n: sum.n + s.n, amount: sum.amount + (s.amount ?? 0) }), { n: 0, amount: 0 });
    const other = byStatus.filter((s) => !KNOWN.has(s.status));
    const visible = showMoney ? STATUS_CARDS : STATUS_CARDS.filter((c) => c.key !== "paid");
    const cards: Card[] = other.length
        ? [...visible, { key: "other", label: msg("Other"), statuses: other.map((s) => s.status), icon: <QuestionOutlined />, accent: ACCENT.other }]
        : visible;

    return (
        <Row gutter={[12, 12]}>
            {cards.map((card) => {
                const { n, amount } = total(card.statuses);
                const active = selected === card.key;
                return (
                    <Col key={card.key} xs={12} md={8} xl={6}>
                        <button
                            type="button"
                            onClick={() => onSelect(active ? "all" : card.key)}
                            aria-pressed={active}
                            className="status-card"
                            style={{
                                width: "100%", height: "100%", padding: "14px 16px", borderRadius: 8, textAlign: "start", cursor: "pointer",
                                background: active ? "#fbf6f3" : "#fff",
                                border: active ? "2px solid #7a3b2e" : "1px solid #f0f0f0",
                                margin: active ? 0 : 1, // keeps the size when the border thickens
                                boxShadow: "0 1px 2px rgba(43, 26, 22, 0.04)",
                                opacity: n === 0 && !active ? 0.6 : 1,
                                display: "flex", alignItems: "center", gap: 12, transition: "border-color .15s, background .15s",
                            }}
                        >
                            <span
                                aria-hidden="true"
                                style={{
                                    flexShrink: 0, width: 40, height: 40, borderRadius: "50%", display: "grid", placeItems: "center",
                                    fontSize: 18, color: card.accent, background: `${card.accent}1a`,
                                }}
                            >
                                {card.icon}
                            </span>
                            <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                                <span style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.15, color: "#2b1a16", fontVariantNumeric: "tabular-nums" }}>{n}</span>
                                <span style={{ fontSize: 13, color: "#6b5d57", lineHeight: 1.3 }}>{t(card.label)}</span>
                                {showMoney && (
                                    <span style={{ fontSize: 12, color: "#7a3b2e", fontVariantNumeric: "tabular-nums" }}>{formatMoney(amount, locale)}</span>
                                )}
                            </span>
                        </button>
                    </Col>
                );
            })}
            <style>{`.status-card:hover { border-color: #c9a99f !important; } .status-card:focus-visible { outline: 2px solid #7a3b2e; outline-offset: 2px; }`}</style>
        </Row>
    );
}
