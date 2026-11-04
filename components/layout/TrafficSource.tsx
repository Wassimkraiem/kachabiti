"use client";

import { useEffect } from "react";
import { rememberTrafficSource } from "@/lib/traffic-source";

/** Notes where this visit came from (Google, Facebook…), once, on the page the shopper landed on. */
export default function TrafficSource() {
    useEffect(() => rememberTrafficSource(), []);
    return null;
}
