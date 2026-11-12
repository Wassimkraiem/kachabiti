"use client";

import { message } from "@/components/admin/antd-app";

type T = (text: string, vars?: Record<string, string | number>) => string;

/**
 * Prints Colissimo slips in one dialog without leaving the page: GET /api/delivery/slips builds
 * one document with every slip (one per A4 sheet) in a hidden frame, printed once it's in.
 * `query` is that endpoint's: "orders=a,b" or "codes=barcode1,barcode2"; `t` the page's
 * translator. The frame goes away after printing (or at the next print).
 */
export function printSlips(query: string, t: T) {
    document.getElementById("slip-printer")?.remove();
    const key = "slip-printer";
    message.loading({ content: t("Preparing the slips…"), key, duration: 0 });
    const frame = document.createElement("iframe");
    frame.id = "slip-printer";
    frame.title = "Colissimo slips";
    frame.setAttribute("aria-hidden", "true");
    // Off screen, not display:none: a hidden frame still has to lay out and print.
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
    frame.src = `/api/delivery/slips?${query}`;
    frame.onload = () => {
        const doc = frame.contentDocument;
        if (!doc?.querySelector(".bl-container")) {
            // An error from the API (JSON): say it instead of printing it.
            let error = "No delivery slip to print";
            try { error = JSON.parse(doc?.body.innerText ?? "").error ?? error; } catch { /* not JSON */ }
            message.error({ content: t(error), key });
            frame.remove();
            return;
        }
        const missing = Number(doc.querySelector('meta[name="slips-missing"]')?.getAttribute("content") ?? 0);
        if (missing > 0) message.warning({ content: t("{count} order(s) have no Colissimo slip yet", { count: missing }), key });
        else message.success({ content: t("{count} slip(s) ready to print", { count: doc.querySelectorAll(".bl-container").length }), key, duration: 2 });
        frame.contentWindow?.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 500));
        // A moment for the images (QR code, logo) to arrive.
        setTimeout(() => frame.contentWindow?.print(), 600);
    };
    document.body.appendChild(frame);
}
