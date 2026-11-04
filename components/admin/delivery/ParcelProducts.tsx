"use client";

import { useEffect, useRef, useState } from "react";
import { Button, InputNumber, Select, Space, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useAdminT } from "@/lib/admin-i18n";
import { searchByText } from "@/components/admin/select-search";
import { deliveryApi } from "./delivery-api";

const { Text } = Typography;

export interface ProductLine {
    key: number;
    product_id?: string;
    variant_id?: string;
    quantity: number;
}

/** A line as the server priced it (catalog price and discount), with the stock it would take from. */
export interface QuotedLine {
    product_id: string;
    variant_id: string | null;
    variant_label: string | null;
    product_name: string;
    quantity: number;
    price: number;
    subtotal: number;
    stock: number | null;
}

interface ProductOption {
    id: string;
    name: string;
    name_fr?: string | null;
    name_ar?: string | null;
    base_price: number;
    deleted_at: string | null;
    product_images?: { image_url: string; is_main: boolean; position: number }[];
}

interface VariantOption {
    id: string;
    price: number | null;
    stock: number;
    is_available: boolean | null;
    colors: { name: string; display_name: string | null } | null;
    sizes: { name: string } | null;
}

const variantName = (v: VariantOption) => [v.colors?.display_name || v.colors?.name, v.sizes?.name].filter(Boolean).join(" / ") || "—";

/** True when a line can be priced: a product, and a size/colour when the product has several. */
export function lineIsComplete(line: ProductLine, variantsByProduct: Record<string, VariantOption[]>) {
    if (!line.product_id) return false;
    const variants = variantsByProduct[line.product_id];
    if (!variants) return false;
    return variants.length <= 1 || !!line.variant_id;
}

/**
 * Products of a parcel entered by hand: product, size/colour and quantity per line. Lines are priced
 * by the server (POST /api/delivery action `quote`), so the amounts match the order it will create.
 * `onQuote` receives the priced complete lines (or null while some line is incomplete).
 */
export default function ParcelProducts({ lines, onChange, onQuote }: {
    lines: ProductLine[];
    onChange: (lines: ProductLine[]) => void;
    onQuote: (quoted: QuotedLine[] | null) => void;
}) {
    const { t, locale } = useAdminT();
    const [products, setProducts] = useState<ProductOption[]>([]);
    const [variantsByProduct, setVariantsByProduct] = useState<Record<string, VariantOption[]>>({});
    const [quotedByKey, setQuotedByKey] = useState<Record<number, QuotedLine>>({});
    const [quoteError, setQuoteError] = useState<string | null>(null);
    const nextKey = useRef(1000);

    useEffect(() => {
        fetch("/api/products?admin=true&view=summary")
            .then((res) => res.json())
            .then((json) => setProducts(((json.data ?? []) as ProductOption[]).filter((p) => !p.deleted_at)))
            .catch(() => setProducts([]));
    }, []);

    // Variants of every product picked so far (once per product).
    useEffect(() => {
        for (const id of new Set(lines.map((l) => l.product_id).filter(Boolean) as string[])) {
            if (variantsByProduct[id]) continue;
            fetch(`/api/variants?product_id=${id}`)
                .then((res) => res.json())
                .then((json) => setVariantsByProduct((current) => ({
                    ...current,
                    [id]: ((json.data ?? []) as VariantOption[]).filter((v) => v.is_available !== false),
                })))
                .catch(() => setVariantsByProduct((current) => ({ ...current, [id]: [] })));
        }
    }, [lines, variantsByProduct]);

    // Price the complete lines whenever they change.
    const quoteKey = JSON.stringify(lines.map((l) => [l.product_id, l.variant_id, l.quantity]));
    useEffect(() => {
        const complete = lines.filter((l) => lineIsComplete(l, variantsByProduct));
        const allComplete = complete.length === lines.length && lines.length > 0;
        if (complete.length === 0) {
            setQuotedByKey({});
            onQuote(lines.length === 0 ? [] : null);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            deliveryApi<{ lines: QuotedLine[] }>({
                method: "POST",
                body: { action: "quote", items: complete.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id ?? null, quantity: l.quantity })) },
            })
                .then((result) => {
                    if (cancelled) return;
                    // The server answers in the order the lines were sent.
                    setQuotedByKey(Object.fromEntries(complete.map((l, i) => [l.key, result.lines[i]])));
                    setQuoteError(null);
                    onQuote(allComplete ? result.lines : null);
                })
                .catch((e) => {
                    if (cancelled) return;
                    setQuoteError((e as Error).message);
                    onQuote(null);
                });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
        // onQuote is a callback from the parent; quoteKey tracks the lines' content.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quoteKey, variantsByProduct]);

    const update = (key: number, change: Partial<ProductLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...change } : l)));

    const productOptions = products.map((p) => ({
        value: p.id,
        label: (locale === "fr" ? p.name_fr : locale === "ar" ? p.name_ar : null) || p.name,
        searchtext: [p.name, p.name_fr, p.name_ar].filter(Boolean).join(" "),
    }));

    return (
        <Space orientation="vertical" size={10} style={{ width: "100%" }}>
            {lines.map((line) => {
                const variants = line.product_id ? variantsByProduct[line.product_id] : undefined;
                const quote = lineIsComplete(line, variantsByProduct) ? quotedByKey[line.key] : undefined;
                return (
                    <div key={line.key} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start", paddingBottom: 10, borderBottom: "1px dashed #f0f0f0" }}>
                        <Select
                            showSearch
                            placeholder={t("Product")}
                            value={line.product_id}
                            options={productOptions}
                            filterOption={searchByText}
                            onChange={(value: string) => update(line.key, { product_id: value, variant_id: undefined })}
                            style={{ flex: "2 1 220px", minWidth: 0 }}
                        />
                        {variants && variants.length > 1 && (
                            <Select
                                placeholder={t("Size / colour")}
                                value={line.variant_id}
                                onChange={(value: string) => update(line.key, { variant_id: value })}
                                options={variants.map((v) => ({ value: v.id, label: variantName(v), searchtext: variantName(v) }))}
                                showSearch
                                filterOption={searchByText}
                                status={!line.variant_id ? "warning" : undefined}
                                style={{ flex: "1 1 150px", minWidth: 0 }}
                            />
                        )}
                        <InputNumber
                            min={1}
                            max={999}
                            precision={0}
                            value={line.quantity}
                            onChange={(value) => update(line.key, { quantity: Number(value) || 1 })}
                            style={{ width: 80 }}
                            aria-label={t("Quantity")}
                        />
                        <Button type="text" danger icon={<DeleteOutlined />} aria-label={t("Remove")} onClick={() => onChange(lines.filter((l) => l.key !== line.key))} />
                        {quote && (
                            <Text type="secondary" style={{ flexBasis: "100%", fontSize: 12 }}>
                                {t("{quantity} × {price} TND = {subtotal} TND", { quantity: quote.quantity, price: quote.price, subtotal: quote.subtotal })}
                                {" · "}
                                {quote.stock === null
                                    ? t("Stock not tracked")
                                    : quote.stock >= quote.quantity
                                        ? t("{count} in stock", { count: quote.stock })
                                        : t("{count} in stock, the rest is made to order", { count: Math.max(0, quote.stock) })}
                            </Text>
                        )}
                    </div>
                );
            })}
            {quoteError && <Text type="danger">{quoteError}</Text>}
            <Button
                icon={<PlusOutlined />}
                onClick={() => onChange([...lines, { key: nextKey.current++, quantity: 1 }])}
            >
                {t("Add a product")}
            </Button>
        </Space>
    );
}
