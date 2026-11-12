"use client";

import { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { headerConfig } from "@/lib/config";
import { footerConfig, type FooterLink, type FooterSection as FooterSectionType } from "@/lib/footer-config";
import { useLanguageSafe } from "@/lib/language-context";
import SocialLinks from "../sections/SocialLinks";
import FooterSection from "./FooterSection";
import NewsletterForm from "../sections/NewsletterForm";

const footerTranslations = {
    en: {
        tagline: "Discover authentic Tunisian handcrafted products and traditional treasures.",
        quickLinks: "Quick Links",
        about: "About",
        legal: "Legal",
        categories: "Categories",
        discounts: "Discounts",
        newArrivals: "New Arrivals",
        bestSellers: "Best Sellers",
        aboutUs: "About Us",
        contact: "Contact",
        faqs: "FAQs",
        termsConditions: "Terms & Conditions",
        privacyPolicy: "Privacy Policy",
        shippingPolicy: "Shipping Policy",
        newsletterTitle: "Subscribe to our newsletter",
        newsletterSubtitle: "Get the latest updates on new products and exclusive offers",
        newsletterPlaceholder: "Enter your email",
        copyright: "Kachabity. All rights reserved."
    },
    fr: {
        tagline: "Découvrez des produits artisanaux tunisiens authentiques et des trésors traditionnels.",
        quickLinks: "Liens rapides",
        about: "À propos",
        legal: "Légal",
        categories: "Catégories",
        discounts: "Remises",
        newArrivals: "Nouveautés",
        bestSellers: "Meilleures ventes",
        aboutUs: "À propos de nous",
        contact: "Contact",
        faqs: "FAQ",
        termsConditions: "Termes et conditions",
        privacyPolicy: "Politique de confidentialité",
        shippingPolicy: "Politique d'expédition",
        newsletterTitle: "Abonnez-vous à notre newsletter",
        newsletterSubtitle: "Recevez les dernières mises à jour sur les nouveaux produits et offres exclusives",
        newsletterPlaceholder: "Entrez votre e-mail",
        copyright: "Kachabity. Tous droits réservés."
    },
    ar: {
        tagline: "اكتشف المنتجات الحرفية التونسية الأصيلة والكنوز التقليدية.",
        quickLinks: "روابط سريعة",
        about: "حول",
        legal: "قانوني",
        categories: "الفئات",
        discounts: "التخفيضات",
        newArrivals: "وصل حديثاً",
        bestSellers: "الأكثر مبيعاً",
        aboutUs: "من نحن",
        contact: "اتصل بنا",
        faqs: "الأسئلة الشائعة",
        termsConditions: "الشروط والأحكام",
        privacyPolicy: "سياسة الخصوصية",
        shippingPolicy: "سياسة الشحن",
        newsletterTitle: "اشترك في نشرتنا الإخبارية",
        newsletterSubtitle: "احصل على آخر التحديثات حول المنتجات الجديدة والعروض الحصرية",
        newsletterPlaceholder: "أدخل بريدك الإلكتروني",
        copyright: "قشابِـيتي. جميع الحقوق محفوظة."
    }
};

function resolveHref(href: string, locale: string) {
    if (!href) {
        return `/${locale}`;
    }

    const trimmedHref = href.trim();

    if (
        trimmedHref.startsWith("http://") ||
        trimmedHref.startsWith("https://") ||
        trimmedHref.startsWith("mailto:") ||
        trimmedHref.startsWith("tel:") ||
        trimmedHref.startsWith("#")
    ) {
        return trimmedHref;
    }

    switch (trimmedHref) {
        case "/":
            return `/${locale}`;
        case "/categories":
            return `/${locale}/categories`;
        case "/discounts":
            return `/${locale}/promotions`;
        case "/new":
            return `/${locale}/products?sort=new`;
        case "/bestsellers":
            return `/${locale}/products?sort=popular`;
        case "/faqs":
            return `/${locale}/faq`;
        default:
            if (trimmedHref.startsWith("/")) {
                return `/${locale}${trimmedHref}`;
            }
            return `/${locale}/${trimmedHref}`;
    }
}

function withResolvedLinks(section: FooterSectionType, locale: string): FooterSectionType {
    const links = section.links.map((link: FooterLink) => ({
        ...link,
        href: resolveHref(link.href, locale)
    }));

    return { ...section, links };
}

export default function Footer() {
    const params = useParams();
    const languageContext = useLanguageSafe();
    const localeParam = params?.locale;
    const locale = Array.isArray(localeParam)
        ? (localeParam[0] || languageContext?.locale || "en")
        : (localeParam || languageContext?.locale || "en");
    const t = footerTranslations[locale as keyof typeof footerTranslations] || footerTranslations.en;

    // Create translated sections
    const translatedSections = useMemo(() => {
        return [
            {
                title: t.quickLinks,
                links: [
                    { label: t.categories, href: "/categories" },
                    { label: t.discounts, href: "/discounts" },
                    { label: t.newArrivals, href: "/new" },
                    { label: t.bestSellers, href: "/bestsellers" }
                ]
            },
            {
                title: t.about,
                links: [
                    { label: t.aboutUs, href: "/about" },
                    { label: t.contact, href: "/contact" },
                    { label: t.faqs, href: "/faqs" }
                ]
            },
            {
                title: t.legal,
                links: [
                    { label: t.termsConditions, href: "/terms-and-conditions" },
                    { label: t.privacyPolicy, href: "/privacy" },
                    { label: t.shippingPolicy, href: "/shipping" }
                ]
            }
        ];
    }, [t]);

    const resolvedSections = useMemo(
        () => translatedSections.map((section) => withResolvedLinks(section, locale)),
        [translatedSections, locale]
    );

    return (
        <footer className="w-full bg-white border-t border-[#842E1B]">
            <div className="max-w-7xl mx-auto px-4 py-12">
                {/* Main Footer Content */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-8 mb-12">
                    {/* Brand Section */}
                    <div className="lg:col-span-3">
                        <Link href={`/${locale}`} className="flex items-center gap-2 mb-4">
                            <Image
                                src={footerConfig.brand.logo}
                                alt={footerConfig.brand.name}
                                width={120}
                                height={40}
                                className="h-10 w-auto"
                            />
                            <Image
                                src={footerConfig.brand.sublogo}
                                alt={footerConfig.brand.name}
                                width={40}
                                height={40}
                                className="rounded"
                            />
                        </Link>
                        <p className="text-gray-600 text-sm mb-6 max-w-sm">
                            {t.tagline}
                        </p>
                        <SocialLinks />
                    </div>

                    {/* Footer Sections */}
                    <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-3 gap-8">
                        {resolvedSections.map((section, index) => (
                            <FooterSection key={index} section={section} />
                        ))}
                    </div>

                    {/* Newsletter Section */}
                    <div className="lg:col-span-3">
                        <div className="text-[#2b1a16]">
                            <NewsletterForm
                                title={t.newsletterTitle}
                                subtitle={t.newsletterSubtitle}
                                placeholder={t.newsletterPlaceholder}
                            />
                        </div>
                    </div>
                </div>

                {/* Copyright and Contact Section */}
                <div className="border-t border-gray-200 pt-8">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                        {/* Copyright */}
                        <p className="text-gray-500 text-sm text-center md:text-left">
                            © {footerConfig.copyright.year} {t.copyright}
                        </p>

                        {/* Contact Info */}
                        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 text-sm text-gray-600">
                            <a
                                href={`tel:${headerConfig.contact.phone}`}
                                className="flex items-center gap-2 hover:text-[#842E1B] transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                </svg>
                                <span dir="ltr">{headerConfig.contact.phone}</span>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
}