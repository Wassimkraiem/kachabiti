"use client";

import { useMemo, useRef, useState } from "react";

/**
 * Small dependency-free SVG charts for the admin dashboards. One series per chart (never two
 * scales on one axis): compare measures with two charts side by side. Marks are thin with
 * rounded data ends on the baseline, the grid is recessive, and every mark has a hover tooltip.
 */

const SERIES = "#2a78d6";
const SERIES_HOVER = "#1d5fae";
const GRID = "#ececec";
const INK_MUTED = "#8c8c8c";
const INK = "#1c1d27";

export interface Point {
    label: string;      // x label (e.g. a day)
    value: number;
    tooltip?: string;   // full text on hover
}

function niceMax(max: number) {
    if (max <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    const n = max / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * pow;
}

const compact = (n: number) =>
    Math.abs(n) >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : Math.abs(n) >= 1_000 ? `${Math.round(n / 100) / 10}k` : `${Math.round(n * 10) / 10}`;

/** Vertical bars over time (one bar per point), with a hover tooltip. */
export function BarChart({ data, height = 200, color = SERIES, format = compact, emptyText = "—" }: {
    data: Point[];
    height?: number;
    color?: string;
    format?: (n: number) => string;
    emptyText?: string;
}) {
    const [hover, setHover] = useState<number | null>(null);
    const ref = useRef<SVGSVGElement>(null);
    const width = 640;
    const pad = { top: 12, right: 8, bottom: 22, left: 40 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const max = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.value))), [data]);
    if (!data.length || data.every((d) => d.value === 0)) {
        return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: INK_MUTED, fontSize: 13 }}>{emptyText}</div>;
    }
    const slot = innerW / data.length;
    const barW = Math.max(2, Math.min(28, slot - 2)); // 2px surface gap between bars
    const labelEvery = Math.ceil(data.length / 8);
    const ticks = [0, 0.5, 1].map((f) => f * max);
    const y = (v: number) => pad.top + innerH - (v / max) * innerH;
    const hovered = hover !== null ? data[hover] : null;

    return (
        <div style={{ position: "relative" }}>
            <svg ref={ref} viewBox={`0 0 ${width} ${height}`} width="100%" role="img" style={{ display: "block", overflow: "visible" }}
                onMouseLeave={() => setHover(null)}>
                {ticks.map((tick) => (
                    <g key={tick}>
                        <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke={GRID} strokeWidth={1} />
                        <text x={pad.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={INK_MUTED}>{format(tick)}</text>
                    </g>
                ))}
                {data.map((d, i) => {
                    const x = pad.left + i * slot + (slot - barW) / 2;
                    const h = Math.max(0, (d.value / max) * innerH);
                    const r = Math.min(4, barW / 2, h);
                    const top = pad.top + innerH - h;
                    return (
                        <g key={i} onMouseEnter={() => setHover(i)}>
                            {/* Hit target: the whole column. */}
                            <rect x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} fill="transparent" />
                            {h > 0 && (
                                <path
                                    d={`M${x},${pad.top + innerH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${pad.top + innerH} Z`}
                                    fill={hover === i ? SERIES_HOVER : color}
                                />
                            )}
                            {i % labelEvery === 0 && (
                                <text x={pad.left + i * slot + slot / 2} y={height - 6} textAnchor="middle" fontSize={11} fill={INK_MUTED}>{d.label}</text>
                            )}
                        </g>
                    );
                })}
                <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} stroke="#d9d9d9" strokeWidth={1} />
            </svg>
            {hovered && hover !== null && (
                <div
                    style={{
                        position: "absolute", top: 0,
                        left: `${((pad.left + hover * slot + slot / 2) / width) * 100}%`,
                        transform: `translateX(${hover > data.length / 2 ? "-105%" : "5%"})`,
                        background: "#fff", border: "1px solid #e5e5e5", borderRadius: 8, padding: "6px 10px",
                        fontSize: 12, color: INK, boxShadow: "0 4px 14px rgba(0,0,0,0.08)", pointerEvents: "none", whiteSpace: "nowrap", zIndex: 2,
                    }}
                >
                    {hovered.tooltip ?? `${hovered.label}: ${format(hovered.value)}`}
                </div>
            )}
        </div>
    );
}

/** Ranked horizontal bars (label, bar, value), for categories like channels or products. */
export function BarList({ rows, format = compact, color = SERIES, max }: {
    rows: { key: string; label: React.ReactNode; value: number; sub?: React.ReactNode; tooltip?: string }[];
    format?: (n: number) => string;
    color?: string;
    max?: number;
}) {
    const top = max ?? Math.max(0, ...rows.map((r) => r.value));
    if (!rows.length) return <div style={{ color: INK_MUTED, fontSize: 13, padding: "12px 0" }}>—</div>;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((row) => (
                <div key={row.key} title={row.tooltip}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, marginBottom: 4 }}>
                        <span style={{ color: INK, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</span>
                        <span style={{ color: INK, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{format(row.value)}</span>
                    </div>
                    <div style={{ height: 8, background: "#f3f3f3", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ width: `${top > 0 ? Math.max(0, (row.value / top) * 100) : 0}%`, height: "100%", background: color, borderRadius: 4 }} />
                    </div>
                    {row.sub && <div style={{ fontSize: 12, color: INK_MUTED, marginTop: 3 }}>{row.sub}</div>}
                </div>
            ))}
        </div>
    );
}

/** Parts of a whole as a ring: each slice shows its share, with a legend and a hover title. */
export function Donut({ slices, size = 220, emptyText = "—" }: {
    slices: { key: string; label: string; value: number; color: string }[];
    size?: number;
    emptyText?: string;
}) {
    const total = slices.reduce((sum, s) => sum + s.value, 0);
    if (total <= 0) return <div style={{ height: size, display: "flex", alignItems: "center", justifyContent: "center", color: INK_MUTED, fontSize: 13 }}>{emptyText}</div>;
    const r = 80, width = 46, circ = 2 * Math.PI * r;
    let start = 0; // fraction of the ring already drawn, from 12 o'clock clockwise
    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <svg viewBox="0 0 220 220" width={size} height={size} role="img">
                {slices.filter((s) => s.value > 0).map((s) => {
                    const share = s.value / total;
                    const mid = (start + share / 2) * 2 * Math.PI - Math.PI / 2;
                    const offset = -start * circ;
                    start += share;
                    return (
                        <g key={s.key}>
                            <circle cx={110} cy={110} r={r} fill="none" stroke={s.color} strokeWidth={width}
                                strokeDasharray={`${share * circ} ${circ}`} strokeDashoffset={offset} transform="rotate(-90 110 110)">
                                <title>{`${s.label}: ${s.value} (${Math.round(share * 1000) / 10}%)`}</title>
                            </circle>
                            {share >= 0.04 && (
                                <text x={110 + r * Math.cos(mid)} y={110 + r * Math.sin(mid)} textAnchor="middle" dominantBaseline="middle"
                                    fontSize={13} fill="#ffffff" style={{ pointerEvents: "none" }}>{`${Math.round(share * 1000) / 10}%`}</text>
                            )}
                        </g>
                    );
                })}
            </svg>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center", fontSize: 13, color: INK }}>
                {slices.map((s) => (
                    <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 12, height: 12, borderRadius: "50%", background: s.color }} />
                        {s.label} <span style={{ color: INK_MUTED, fontVariantNumeric: "tabular-nums" }}>{s.value}</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

/** A thin progress bar against an objective (100% = target). */
export function TargetBar({ value, target, format = compact }: { value: number; target: number | null | undefined; format?: (n: number) => string }) {
    if (!target) return <span style={{ color: INK_MUTED, fontVariantNumeric: "tabular-nums" }}>{format(value)}</span>;
    const pct = Math.round((value / target) * 100);
    const color = pct >= 100 ? "#008300" : pct >= 60 ? SERIES : "#eda100";
    return (
        <div style={{ minWidth: 120 }} title={`${format(value)} / ${format(target)} (${pct}%)`}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                <span>{format(value)} / {format(target)}</span>
                <span style={{ color: INK_MUTED }}>{pct}%</span>
            </div>
            <div style={{ height: 6, background: "#f0f0f0", borderRadius: 3, marginTop: 3 }}>
                <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color, borderRadius: 3 }} />
            </div>
        </div>
    );
}
