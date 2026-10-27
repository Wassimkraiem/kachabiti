"use client";

import { isRTL } from "@/lib/language-utils";
import type { CustomerStage } from "@/lib/colissimo-data";

/** An order's parcel as GET /api/account/orders returns it (null until it's sent). */
export interface OrderDelivery {
    stage: CustomerStage;
    barcode: string | null;
    updated_at: string | null;
}

const translations = {
    en: {
        steps: ["Order placed", "Shipped", "Out for delivery", "Delivered"],
        preparing: "We're preparing your order.",
        shipped: "Your parcel is with Colissimo.",
        out_for_delivery: "The driver is on the way: keep your phone close.",
        delivered: "Delivered. Thank you for your order!",
        returned: "Your parcel came back to us. We'll contact you.",
        problem: "Colissimo is checking your parcel. We'll contact you if needed.",
        cancelled: "This order was cancelled.",
        tracking: "Colissimo tracking number",
        updated: "Updated",
    },
    fr: {
        steps: ["Commande passée", "Expédiée", "En cours de livraison", "Livrée"],
        preparing: "Nous préparons votre commande.",
        shipped: "Votre colis est chez Colissimo.",
        out_for_delivery: "Le livreur est en route : gardez votre téléphone à portée de main.",
        delivered: "Livrée. Merci pour votre commande !",
        returned: "Votre colis nous a été retourné. Nous vous contacterons.",
        problem: "Colissimo vérifie votre colis. Nous vous contacterons si besoin.",
        cancelled: "Cette commande a été annulée.",
        tracking: "Numéro de suivi Colissimo",
        updated: "Mis à jour",
    },
    ar: {
        steps: ["تم الطلب", "تم الشحن", "في الطريق إليك", "تم التسليم"],
        preparing: "نحن نجهّز طلبك.",
        shipped: "طردك لدى كوليسيمو.",
        out_for_delivery: "عامل التوصيل في الطريق: أبقِ هاتفك قريباً منك.",
        delivered: "تم التسليم. شكراً على طلبك!",
        returned: "عاد طردك إلينا. سنتواصل معك.",
        problem: "كوليسيمو يتحقق من طردك. سنتواصل معك عند الحاجة.",
        cancelled: "تم إلغاء هذا الطلب.",
        tracking: "رقم التتبع لدى كوليسيمو",
        updated: "آخر تحديث",
    },
};

const STEP: Partial<Record<CustomerStage, number>> = { preparing: 0, shipped: 1, out_for_delivery: 2, delivered: 3 };

/** Where an order stands, from its parcel (or its status before it's sent). */
function stageOf(orderStatus: string, delivery: OrderDelivery | null): CustomerStage | "cancelled" {
    if (orderStatus === "cancelled") return "cancelled";
    if (delivery) return delivery.stage;
    if (orderStatus === "delivered") return "delivered";
    if (orderStatus === "shipped") return "shipped";
    if (orderStatus === "returned") return "returned";
    return "preparing";
}

/** The shopper's view of an order's delivery: a four-step progress bar and what it means. */
export default function OrderTracking({ orderStatus, delivery, locale }: { orderStatus: string; delivery: OrderDelivery | null; locale: string }) {
    const text = translations[(locale as keyof typeof translations) in translations ? (locale as keyof typeof translations) : "ar"];
    const stage = stageOf(orderStatus, delivery);
    const step = STEP[stage as CustomerStage];
    const off = step === undefined;

    return (
        <div dir={isRTL(locale) ? "rtl" : "ltr"} className="mt-4 rounded-md bg-gray-50 p-4">
            {!off && (
                <ol className="mb-3 flex items-start" aria-label={text.steps.join(", ")}>
                    {text.steps.map((label, index) => {
                        const reached = index <= step;
                        return (
                            <li key={label} className="flex flex-1 flex-col items-center text-center" aria-current={index === step ? "step" : undefined}>
                                <div className="flex w-full items-center">
                                    <span className={`h-0.5 flex-1 ${index === 0 ? "invisible" : reached ? "bg-[#7a3b2e]" : "bg-gray-300"}`} />
                                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${reached ? "bg-[#7a3b2e] text-white" : "bg-gray-200 text-gray-500"}`}>
                                        {reached ? "✓" : index + 1}
                                    </span>
                                    <span className={`h-0.5 flex-1 ${index === text.steps.length - 1 ? "invisible" : index < step ? "bg-[#7a3b2e]" : "bg-gray-300"}`} />
                                </div>
                                <span className={`mt-1 text-xs ${reached ? "font-medium text-gray-900" : "text-gray-500"}`}>{label}</span>
                            </li>
                        );
                    })}
                </ol>
            )}
            <p className={`text-sm ${stage === "returned" || stage === "problem" || stage === "cancelled" ? "text-amber-700" : "text-gray-700"}`}>
                {text[stage]}
            </p>
            {delivery?.barcode && stage !== "cancelled" && (
                <p className="mt-1 text-xs text-gray-500">
                    {text.tracking}: <span className="font-mono text-gray-900" dir="ltr">{delivery.barcode}</span>
                    {delivery.updated_at && (
                        <> · {text.updated} {new Date(delivery.updated_at).toLocaleDateString(locale)}</>
                    )}
                </p>
            )}
        </div>
    );
}
