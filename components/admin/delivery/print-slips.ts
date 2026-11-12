"use client";

/**
 * Prints Colissimo slips without leaving the page: /admin/delivery/print loads in a hidden frame
 * and opens the print dialog itself once the slips are in. `query` is that page's: "orders=a,b"
 * or "codes=barcode1,barcode2". The frame goes away after printing (or at the next print).
 */
export function printSlips(query: string) {
    document.getElementById("slip-printer")?.remove();
    const frame = document.createElement("iframe");
    frame.id = "slip-printer";
    frame.title = "Colissimo slips";
    frame.setAttribute("aria-hidden", "true");
    // Off screen, not display:none: a hidden frame still has to lay out and print.
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
    frame.src = `/admin/delivery/print?${query}`;
    frame.onload = () => {
        frame.contentWindow?.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 500));
    };
    document.body.appendChild(frame);
}
