"use client";

import Link from "next/link";
import type { FooterSection as FooterSectionType } from "@/lib/footer-config";

interface FooterSectionProps {
    section: FooterSectionType;
}

export default function FooterSection({ section }: FooterSectionProps) {
    return (
        <div>
            <h3 className="text-lg font-semibold text-ink mb-4">
                {section.title}
            </h3>
            <ul className="space-y-0.5 sm:space-y-2">
                {section.links.map((link) => (
                    <li key={link.href}>
                        <Link
                            href={link.href}
                            className="inline-flex min-h-11 items-center text-mute hover:text-accent transition-colors text-sm sm:min-h-0"
                        >
                            {link.label}
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}

