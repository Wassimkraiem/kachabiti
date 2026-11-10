"use client";

import { usePathname } from "next/navigation";
import TermsSection from "@/components/sections/TermsSection";
import { headerConfig } from "@/lib/config";

// Define content type for better type safety
interface TermsContent {
    title: string;
    subtitle: string;
    ctaMessage: string;
    ctaButton: string;
    sections: {
        [key: string]: {
            title: string;
            content: string[];
        };
    };
}

const getContent = (): Record<string, TermsContent> => ({
    en: {
        title: "Terms & Conditions",
        subtitle: "Please read these terms and conditions carefully before using our service.",
        ctaMessage: "Have questions? We're here to help!",
        ctaButton: "Contact Us",
        sections: {
            intro: {
                title: "Terms & Conditions Overview",
                content: [
                    "Welcome to Kachabity. These Terms & Conditions explain the legal agreement between you and Kachabity when you use our website, browse our catalogue, or place an order.",
                    "Please read this document together with our Privacy Policy and Shipping Policy. The Terms & Conditions describe the contractual rules of engagement, while the Privacy Policy focuses on how we handle your personal data and the Shipping Policy outlines how and when your order will arrive.",
                    "By accessing or using this website, you agree to comply with these Terms & Conditions. If you do not agree with any part of these terms, please discontinue use of the site."
                ]
            },
            orders: {
                title: "Orders, Payments, & Eligibility",
                content: [
                    "When you place an order, you make an offer to purchase one or more products under these Terms & Conditions. All orders are subject to product availability and price confirmation at the time of checkout.",
                    "Payments are accepted via cash on delivery. Prices are displayed in Tunisian Dinar (TND) and include applicable taxes unless otherwise indicated.",
                    "We reserve the right to refuse or cancel any order, limit quantities purchased per person or household, and request additional information to verify billing or identity."
                ]
            },
            shipping: {
                title: "Shipping Policy",
                content: [
                    "We currently ship to addresses within Tunisia. Orders are delivered within 48 hours after confirmation, subject to exceptional delays caused by product availability, courier capacity, weather, or public holidays.",
                    "Shipping fees are calculated at checkout and include handling and packaging. Orders over the free-shipping threshold listed on our website may qualify for complimentary delivery.",
                    "Once your parcel is transferred to the carrier, risk of loss passes to you. Please inspect your package upon receipt and contact us within 48 hours if anything is missing or damaged.",
                    "For the most up-to-date information on delivery windows, carrier partners, or international shipping availability, please review the dedicated Shipping Policy page."
                ]
            },
            returns: {
                title: "Returns and Refunds",
                content: [
                    "If you are not satisfied with your purchase, you may return eligible products within 14 days of delivery for a refund or exchange.",
                    "Products must be unused, in their original packaging, and in the same condition that you received them. Handmade items may have special return conditions.",
                    `To initiate a return, please call our customer service team at ${headerConfig.contact.phone} with your order number and reason for return.`
                ]
            },
            intellectual: {
                title: "Intellectual Property",
                content: [
                    "All content on this website, including text, graphics, logos, images, and software, is the property of Kachabity and is protected by international copyright laws.",
                    "You may not reproduce, distribute, modify, or create derivative works of our content without our express written permission."
                ]
            },
            liability: {
                title: "Limitation of Liability",
                content: [
                    "Kachabity shall not be liable for any indirect, incidental, special, consequential or punitive damages resulting from your use of or inability to use the service.",
                    "Our total liability to you for all claims arising from or related to the service shall not exceed the amount you paid to us for the products."
                ]
            },
            privacy: {
                title: "Privacy Policy",
                content: [
                    "Your privacy matters to us. Our Privacy Policy explains in detail what personal information we collect, how we use it, how long we retain it, and the safeguards we implement to protect it.",
                    "We only collect the data necessary to process orders, communicate with you, and improve our services. You can request access to, correction of, or deletion of your personal data at any time by contacting us.",
                    "By using our services, you consent to the practices described in the Privacy Policy. If you disagree with any part of that policy, please discontinue use of the site or contact us for clarification."
                ]
            },
            changes: {
                title: "Changes to Terms",
                content: [
                    "We reserve the right to modify these terms and conditions at any time. Changes will be effective immediately upon posting to the website.",
                    "Your continued use of the website following the posting of changes constitutes your acceptance of such changes."
                ]
            },
            contact: {
                title: "Contact Us",
                content: [
                    "If you have any questions about these Terms and Conditions, please contact us:",
                    `Phone: ${headerConfig.contact.phone}`
                ]
            }
        }
    },
    fr: {
        title: "Termes et Conditions",
        subtitle: "Veuillez lire attentivement ces termes et conditions avant d'utiliser notre service.",
        ctaMessage: "Vous avez des questions ? Nous sommes là pour vous aider !",
        ctaButton: "Contactez-nous",
        sections: {
            intro: {
                title: "Aperçu des Termes & Conditions",
                content: [
                    "Bienvenue sur Kachabity. Ces Termes & Conditions précisent l'accord juridique qui vous lie à Kachabity lorsque vous utilisez notre site, naviguez sur notre catalogue ou passez commande.",
                    "Veuillez lire attentivement ce document ainsi que notre Politique de Confidentialité et notre Politique d'Expédition. Les Termes & Conditions définissent les règles contractuelles, la Politique de Confidentialité traite de la gestion de vos données personnelles et la Politique d'Expédition explique comment et quand votre commande vous sera livrée.",
                    "En accédant à ce site, vous acceptez de respecter ces Termes & Conditions. Si vous n'êtes pas d'accord avec l'une de ces conditions, veuillez cesser d'utiliser le site."
                ]
            },
            orders: {
                title: "Commandes, Paiements et Admissibilité",
                content: [
                    "Lorsque vous passez une commande, vous formulez une offre d'achat d'un ou plusieurs produits conformément aux présents Termes & Conditions. Toutes les commandes sont soumises à la disponibilité des produits et à la confirmation du prix indiqué au moment du paiement.",
                    "Nous acceptons le paiement à la livraison. Les prix sont affichés en dinar tunisien (TND) et incluent les taxes applicables, sauf indication contraire.",
                    "Nous nous réservons le droit de refuser ou d'annuler toute commande, de limiter les quantités par personne ou foyer et de vous demander des informations supplémentaires pour vérifier l'identité ou la facturation."
                ]
            },
            shipping: {
                title: "Politique d'Expédition",
                content: [
                    "Nous livrons actuellement partout en Tunisie. Les délais de livraison varient généralement de 2 à 7 jours ouvrables selon la destination, la disponibilité des produits et la capacité des transporteurs.",
                    "Les frais de livraison sont calculés au moment du paiement et incluent la manutention et l'emballage. Les commandes dépassant le seuil de livraison gratuite indiqué sur notre site peuvent bénéficier de frais d'expédition offerts.",
                    "Dès que votre colis est remis au transporteur, le risque de perte vous est transféré. Veuillez inspecter votre colis à la réception et nous contacter dans les 48 heures en cas de produit manquant ou endommagé.",
                    "Pour des informations à jour sur les transporteurs, les zones desservies ou la livraison internationale, consultez notre Politique d'Expédition détaillée."
                ]
            },
            returns: {
                title: "Retours et Remboursements",
                content: [
                    "Si vous n'êtes pas satisfait de votre achat, vous pouvez retourner les produits éligibles dans les 14 jours suivant la livraison.",
                    "Les produits doivent être inutilisés, dans leur emballage d'origine et dans le même état que vous les avez reçus.",
                    `Pour initier un retour, veuillez appeler notre service client au ${headerConfig.contact.phone}.`
                ]
            },
            intellectual: {
                title: "Propriété Intellectuelle",
                content: [
                    "Tout le contenu de ce site Web est la propriété de Kachabity et est protégé par les lois internationales sur le droit d'auteur.",
                    "Vous ne pouvez pas reproduire, distribuer ou modifier notre contenu sans notre permission écrite expresse."
                ]
            },
            liability: {
                title: "Limitation de Responsabilité",
                content: [
                    "Kachabity ne sera pas responsable des dommages indirects, accessoires ou consécutifs résultant de votre utilisation du service.",
                    "Notre responsabilité totale envers vous ne dépassera pas le montant que vous nous avez payé pour les produits."
                ]
            },
            privacy: {
                title: "Politique de Confidentialité",
                content: [
                    "Votre vie privée est essentielle. Notre Politique de Confidentialité décrit quelles données personnelles nous collectons, comment nous les utilisons, combien de temps nous les conservons et les mesures mises en place pour les protéger.",
                    "Nous ne collectons que les informations nécessaires pour traiter vos commandes, communiquer avec vous et améliorer nos services. Vous pouvez demander l'accès, la rectification ou la suppression de vos données personnelles à tout moment en nous contactant.",
                    "En utilisant nos services, vous acceptez les pratiques décrites dans la Politique de Confidentialité. Si vous avez des questions ou des objections, merci de nous contacter avant de poursuivre l'utilisation du site."
                ]
            },
            changes: {
                title: "Modifications des Conditions",
                content: [
                    "Nous nous réservons le droit de modifier ces termes et conditions à tout moment.",
                    "Votre utilisation continue du site Web constitue votre acceptation de ces modifications."
                ]
            },
            contact: {
                title: "Nous Contacter",
                content: [
                    "Si vous avez des questions concernant ces Termes et Conditions, veuillez nous contacter :",
                    `Téléphone : ${headerConfig.contact.phone}`
                ]
            }
        }
    },
    ar: {
        title: "الشروط والأحكام",
        subtitle: "يرجى قراءة هذه الشروط والأحكام بعناية قبل استخدام خدمتنا.",
        ctaMessage: "هل لديك أسئلة؟ نحن هنا للمساعدة!",
        ctaButton: "اتصل بنا",
        sections: {
            intro: {
                title: "نظرة عامة على الشروط والأحكام",
                content: [
                    "مرحبًا بكم في قشابِـيتي. توضح هذه الشروط والأحكام الاتفاق القانوني بينك وبين قشابِـيتي عند استخدام الموقع، تصفّح المنتجات أو تقديم الطلبات.",
                    "يرجى قراءة هذه الوثيقة مع سياسة الخصوصية وسياسة الشحن الخاصة بنا. تحدد الشروط والأحكام قواعد التعامل، بينما تشرح سياسة الخصوصية كيفية معالجة بياناتك، وتوضح سياسة الشحن كيفية تسليم طلباتك ومتى تصل.",
                    "باستخدامك للموقع، فإنك توافق على الالتزام بهذه الشروط. إذا لم توافق على أي جزء منها، يرجى التوقف عن استخدام الموقع والتواصل معنا للاستفسار."
                ]
            },
            orders: {
                title: "الطلبات والمدفوعات والأهلية",
                content: [
                    "عند تقديم طلب، فإنك تعرض شراء منتج أو أكثر وفقًا لهذه الشروط والأحكام. جميع الطلبات خاضعة لتوافر المنتجات وتأكيد السعر أثناء الدفع.",
                    "نقبل الدفع عند الاستلام. تُعرض الأسعار بالدينار التونسي وتشمل الضرائب المطبقة ما لم يُذكر خلاف ذلك.",
                    "نحتفظ بالحق في رفض أو إلغاء أي طلب، وتحديد الكميات لكل شخص أو لكل عنوان، وطلب معلومات إضافية للتحقق من الهوية أو الفوترة."
                ]
            },
            shipping: {
                title: "سياسة الشحن",
                content: [
                    "نقوم حاليًا بالشحن داخل تونس. يتم توصيل الطلبات خلال 48 ساعة من تأكيدها، مع احتمال حدوث تأخير استثنائي بسبب توفر المنتج أو طاقة شركات النقل أو الطقس أو العطل الرسمية.",
                    "تُحتسب رسوم الشحن عند إتمام الطلب وتشمل المناولة والتغليف. الطلبات التي تتجاوز حد الشحن المجاني المذكور على موقعنا قد تستفيد من توصيل مجاني.",
                    "بعد تسليم الطرد لشركة النقل يتحمّل العميل مخاطر الفقدان. يرجى فحص الطرد فور الاستلام وإبلاغنا خلال 48 ساعة في حال وجود نقص أو تلف.",
                    "للحصول على أحدث المعلومات حول شركات النقل، والمناطق المشمولة أو خيارات الشحن الدولي، يُرجى الاطلاع على صفحة سياسة الشحن."
                ]
            },
            returns: {
                title: "المرتجعات والمبالغ المستردة",
                content: [
                    "إذا لم تكن راضيًا عن عملية الشراء، يمكنك إرجاع المنتجات المؤهلة في غضون 14 يومًا من التسليم.",
                    "يجب أن تكون المنتجات غير مستخدمة وفي عبوتها الأصلية وبنفس الحالة التي استلمتها بها.",
                    `لبدء الإرجاع، يرجى الاتصال بفريق خدمة العملاء على ${headerConfig.contact.phone}.`
                ]
            },
            intellectual: {
                title: "الملكية الفكرية",
                content: [
                    "جميع المحتويات على هذا الموقع هي ملك لقشابِـيتي ومحمية بموجب قوانين حقوق النشر الدولية.",
                    "لا يجوز لك إعادة إنتاج أو توزيع أو تعديل المحتوى الخاص بنا دون إذن كتابي صريح منا."
                ]
            },
            liability: {
                title: "حدود المسؤولية",
                content: [
                    "لن تكون قشابِـيتي مسؤولة عن أي أضرار غير مباشرة أو عرضية أو خاصة ناتجة عن استخدامك للخدمة.",
                    "لن تتجاوز مسؤوليتنا الإجمالية تجاهك المبلغ الذي دفعته لنا مقابل المنتجات."
                ]
            },
            privacy: {
                title: "سياسة الخصوصية",
                content: [
                    "نُولي خصوصيتك أهمية كبيرة. توضح سياسة الخصوصية لدينا البيانات الشخصية التي نجمعها، وكيفية استخدامها، ومدة الاحتفاظ بها، والإجراءات المتبعة لحمايتها.",
                    "نجمع فقط المعلومات اللازمة لمعالجة طلباتك، والتواصل معك، وتحسين خدماتنا. يمكنك طلب الوصول إلى بياناتك أو تعديلها أو حذفها في أي وقت عبر التواصل معنا.",
                    "باستخدامك لخدماتنا، فإنك توافق على الممارسات الموضحة في سياسة الخصوصية. إذا كانت لديك أي أسئلة أو اعتراضات، يسعدنا تواصلك معنا قبل مواصلة استخدام الموقع."
                ]
            },
            changes: {
                title: "التغييرات على الشروط",
                content: [
                    "نحتفظ بالحق في تعديل هذه الشروط والأحكام في أي وقت.",
                    "يشكل استمرارك في استخدام الموقع قبولك لهذه التغييرات."
                ]
            },
            contact: {
                title: "اتصل بنا",
                content: [
                    "إذا كان لديك أي أسئلة حول هذه الشروط والأحكام، يرجى الاتصال بنا:",
                    `الهاتف: ${headerConfig.contact.phone}`
                ]
            }
        }
    }
});

export default function TermsAndConditions() {
    const pathname = usePathname();

    // Extract locale from pathname
    const locale = pathname?.split('/')[1] || 'en';
    const validLocale = ['en', 'fr', 'ar'].includes(locale) ? locale : 'en';

    const content = getContent();
    const text = content[validLocale] || content.en;

    return (
        <>

            <div className="min-h-screen bg-surface">
                {/* Hero Section */}
                <div className="">
                    <div className="max-w-7xl mx-auto px-1 py-16 text-center   border-b-5 border-line">
                        <h1 className=" md:text-4xl font-bold text-ink mb-4">
                            {text.title}
                        </h1>
                        <p className=" text-mute max-w-2xl mx-auto">
                            {text.subtitle}
                        </p>
                        {/* <p className="text-sm text-mute mt-4">
                            {text.lastUpdated}: {new Date().toLocaleDateString(validLocale === 'ar' ? 'ar-TN' : validLocale === 'fr' ? 'fr-FR' : 'en-US', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                            })}
                        </p> */}
                    </div>
                </div>

                {/* Content Section */}
                <div className="max-w-7xl mx-auto py-12">
                    <div>
                        {/* Dynamically render all sections */}
                        {Object.entries(text.sections).map(([key, section], index) => (
                            <TermsSection
                                key={key}
                                title={section.title}
                                content={section.content}
                                isFirst={index === 0}
                            />
                        ))}

                        {/* Contact CTA */}
                        <div className="mt-12 p-6 bg-linear-to-r from-accent to-accent-hover rounded-lg text-center">
                            <p className="text-white mb-4 text-lg">
                                {text.ctaMessage}
                            </p>
                            <a
                                href={`tel:${headerConfig.contact.phone.replace(/\s/g, '')}`}
                                className="inline-block px-8 py-3 bg-card text-accent font-semibold rounded-lg hover:bg-surface transition-colors"
                            >
                                {text.ctaButton}
                            </a>
                        </div>
                    </div>
                </div>
            </div>

        </>
    );
}
