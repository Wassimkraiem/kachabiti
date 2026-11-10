"use client";

import { usePathname } from "next/navigation";
import TermsSection from "@/components/sections/TermsSection";

interface PrivacyContent {
    title: string;
    subtitle: string;
    lastUpdated: string;
    sections: Record<
        string,
        {
            title: string;
            content: string[];
        }
    >;
}

const getContent = (): Record<string, PrivacyContent> => ({
    en: {
        title: "Privacy Policy",
        subtitle: "Your trust matters to us. Learn how we collect, use, and protect your personal information.",
        lastUpdated: "Last updated",
        sections: {
            overview: {
                title: "1. Overview",
                content: [
                    "This Privacy Policy describes how Kachabity (\"we\", \"us\", or \"our\") collects, uses, and protects information about you when you interact with our website, place orders, or engage with our services.",
                    "By using the website, you consent to the practices described in this policy. If you disagree with any part of this policy, please discontinue use of the site or contact us for clarification."
                ]
            },
            dataWeCollect: {
                title: "2. Information We Collect",
                content: [
                    "Account and Contact Data: name, email address, phone number, shipping and billing addresses.",
                    "Order Details: products purchased, payment method (cash on delivery), order history, and any notes you provide.",
                    "Technical Data: IP address, browser type, device information, and pages visited. This data helps us secure the website and improve performance.",
                    "Optional Data: information you provide voluntarily, such as survey responses, product reviews, or customer support messages."
                ]
            },
            howWeUseData: {
                title: "3. How We Use Your Data",
                content: [
                    "To process and deliver your orders, including confirming availability, communicating updates, and arranging shipping.",
                    "To personalize your experience, recommend relevant products, and optimize website content.",
                    "To comply with legal obligations, prevent fraud, and secure our services.",
                    "To send service communications (order confirmations, shipping alerts) and—only with your permission—marketing updates."
                ]
            },
            sharing: {
                title: "4. Sharing & Disclosure",
                content: [
                    "We do not sell your personal information. We share limited data with trusted partners only when necessary to fulfill your order or operate the business (e.g., logistics providers, email service platforms).",
                    "These partners are required to safeguard your information and use it solely for the agreed purpose.",
                    "We may disclose information if required by law, to defend our rights, or to protect the safety of our users."
                ]
            },
            cookies: {
                title: "5. Cookies & Tracking Technologies",
                content: [
                    "We use essential cookies to enable core site features (such as cart functionality) and analytics cookies to understand how visitors use the site.",
                    "You can adjust cookie preferences through your browser settings. Disabling certain cookies may impact site performance."
                ]
            },
            retention: {
                title: "6. Data Retention",
                content: [
                    "We retain personal data only as long as necessary to deliver services, meet legal obligations, or resolve disputes.",
                    "Order-related information may be kept for accounting and regulatory compliance. When data is no longer needed, it is securely deleted or anonymized."
                ]
            },
            rights: {
                title: "7. Your Rights",
                content: [
                    "Depending on your location, you may have the right to access, correct, delete, or restrict the use of your personal data.",
                    "To exercise these rights, or to ask questions about this policy, contact us at privacy@kachabity.com or via the contact details provided in the Terms & Conditions.",
                    "We will respond to verified requests within a reasonable timeframe and in accordance with applicable laws."
                ]
            },
            security: {
                title: "8. Security",
                content: [
                    "We implement administrative, technical, and physical safeguards to protect your information against unauthorized access, alteration, or disclosure.",
                    "While we strive for robust protection, no online transmission or storage system is 100% secure. Please contact us if you suspect unauthorized activity."
                ]
            },
            updates: {
                title: "9. Updates to This Policy",
                content: [
                    "We may update this Privacy Policy to reflect changes in our practices or for legal reasons.",
                    "When we make significant changes, we will post a notice on the website. Your continued use of the site after updates constitutes acceptance of the revised policy."
                ]
            }
        }
    },
    fr: {
        title: "Politique de Confidentialité",
        subtitle: "Votre confiance compte. Découvrez comment nous collectons, utilisons et protégeons vos informations personnelles.",
        lastUpdated: "Dernière mise à jour",
        sections: {
            overview: {
                title: "1. Aperçu",
                content: [
                    "Cette Politique de Confidentialité décrit comment Kachabity (« nous ») collecte, utilise et protège vos informations lorsque vous utilisez notre site, effectuez des commandes ou interagissez avec nos services.",
                    "En utilisant le site, vous acceptez les pratiques décrites dans cette politique. Si vous n'êtes pas d'accord, veuillez cesser d'utiliser le site ou nous contacter."
                ]
            },
            dataWeCollect: {
                title: "2. Données Collectées",
                content: [
                    "Données de compte et de contact : nom, adresse e-mail, numéro de téléphone, adresses de livraison et de facturation.",
                    "Détails de commande : produits achetés, mode de paiement (paiement à la livraison), historique de commande.",
                    "Données techniques : adresse IP, type de navigateur, informations sur l'appareil, pages consultées.",
                    "Données facultatives : réponses aux enquêtes, avis produits ou échanges avec notre service client."
                ]
            },
            howWeUseData: {
                title: "3. Utilisation des Données",
                content: [
                    "Traiter vos commandes, communiquer les mises à jour et organiser l'expédition.",
                    "Personnaliser votre expérience et améliorer nos produits et services.",
                    "Respecter nos obligations légales et protéger notre plateforme contre la fraude.",
                    "Vous envoyer des communications de service et, sous réserve de votre consentement, des offres marketing."
                ]
            },
            sharing: {
                title: "4. Partage des Données",
                content: [
                    "Nous ne vendons pas vos données personnelles. Nous partageons uniquement les informations nécessaires avec des partenaires de confiance (transporteurs, plateformes e-mail) pour exécuter nos services.",
                    "Ces partenaires sont tenus de protéger vos données et de les utiliser uniquement pour la finalité convenue.",
                    "Nous pouvons divulguer des informations si la loi l'exige ou pour protéger nos droits."
                ]
            },
            cookies: {
                title: "5. Cookies et Technologies de Suivi",
                content: [
                    "Nous utilisons des cookies essentiels pour assurer le bon fonctionnement du site et des cookies analytiques pour améliorer l'expérience utilisateur.",
                    "Vous pouvez gérer vos préférences dans les paramètres de votre navigateur. La désactivation de certains cookies peut affecter certaines fonctionnalités."
                ]
            },
            retention: {
                title: "6. Conservation des Données",
                content: [
                    "Nous conservons les données personnelles uniquement pendant la durée nécessaire pour fournir nos services et respecter nos obligations légales.",
                    "Les données liées aux commandes peuvent être conservées pour des raisons comptables et réglementaires. Une fois obsolètes, elles sont supprimées ou anonymisées."
                ]
            },
            rights: {
                title: "7. Vos Droits",
                content: [
                    "Vous pouvez demander l'accès, la rectification ou la suppression de vos données personnelles.",
                    "Pour exercer vos droits, contactez-nous à privacy@kachabity.com ou via les coordonnées indiquées dans les Termes & Conditions.",
                    "Nous répondrons dans un délai raisonnable conformément aux lois en vigueur."
                ]
            },
            security: {
                title: "8. Sécurité",
                content: [
                    "Nous appliquons des mesures techniques et organisationnelles pour protéger vos données personnelles.",
                    "Aucune transmission en ligne n'est totalement sécurisée ; contactez-nous si vous suspectez une utilisation non autorisée."
                ]
            },
            updates: {
                title: "9. Mises à Jour de la Politique",
                content: [
                    "Nous pouvons mettre à jour cette politique afin de refléter des changements légaux ou opérationnels.",
                    "Les modifications importantes seront signalées sur le site. L'utilisation continue vaut acceptation de la politique révisée."
                ]
            }
        }
    },
    ar: {
        title: "سياسة الخصوصية",
        subtitle: "خصوصيتك مهمة لنا. تعرّف على كيفية جمع بياناتك واستخدامها وحمايتها.",
        lastUpdated: "آخر تحديث",
        sections: {
            overview: {
                title: "1. نظرة عامة",
                content: [
                    "توضح سياسة الخصوصية هذه كيفية جمع قشابِـيتي («نحن») لمعلوماتك الشخصية، وكيفية استخدامها وحمايتها عند استخدام الموقع أو تقديم طلب.",
                    "باستخدامك للموقع، فإنك توافق على الممارسات الواردة في هذه السياسة. إذا لم توافق عليها، يرجى التوقف عن استخدام الموقع أو الاتصال بنا."
                ]
            },
            dataWeCollect: {
                title: "2. البيانات التي نجمعها",
                content: [
                    "بيانات الحساب والتواصل: الاسم، البريد الإلكتروني، رقم الهاتف، عناوين الشحن والفوترة.",
                    "تفاصيل الطلب: المنتجات المشتراة، طريقة الدفع (الدفع عند الاستلام)، سجلات الطلب.",
                    "بيانات تقنية: عنوان الـ IP، نوع المتصفح، معلومات الجهاز، الصفحات التي تمت زيارتها.",
                    "بيانات اختيارية: الاستبيانات، تقييمات المنتجات، أو مراسلات خدمة العملاء."
                ]
            },
            howWeUseData: {
                title: "3. كيفية استخدام البيانات",
                content: [
                    "معالجة الطلبات والتواصل معك حول حالة الطلب وتسليم المنتجات.",
                    "تخصيص التجربة وتحسين منتجاتنا وخدماتنا.",
                    "الوفاء بالالتزامات القانونية وحماية منصتنا من الاحتيال.",
                    "إرسال الرسائل المرتبطة بالخدمة، والإشعارات التسويقية عند الموافقة."
                ]
            },
            sharing: {
                title: "4. مشاركة البيانات",
                content: [
                    "لا نبيع بياناتك الشخصية. نشارك فقط المعلومات اللازمة مع شركاء موثوقين (مثل شركات الشحن أو خدمات البريد الإلكتروني) لتقديم خدماتنا.",
                    "يلتزم هؤلاء الشركاء بحماية بياناتك واستخدامها فقط للغرض المتفق عليه.",
                    "قد نكشف المعلومات إذا طُلب منا قانونيًا أو لحماية حقوقنا ومستخدمي الموقع."
                ]
            },
            cookies: {
                title: "5. ملفات تعريف الارتباط",
                content: [
                    "نستخدم ملفات تعريف الارتباط الأساسية لتشغيل الموقع، وملفات تحليلية لفهم كيفية استخدام الزوار للموقع.",
                    "يمكنك إدارة تفضيلات ملفات تعريف الارتباط عبر إعدادات المتصفح. قد يؤدي تعطيل البعض إلى تقييد وظائف معينة."
                ]
            },
            retention: {
                title: "6. الاحتفاظ بالبيانات",
                content: [
                    "نحتفظ بالبيانات الشخصية طالما كانت ضرورية لتقديم خدماتنا أو للامتثال للمتطلبات القانونية.",
                    "قد نحتفظ بمعلومات الطلبات لأغراض محاسبية وتنظيمية. وعند انتهاء الحاجة إليها، يتم حذفها أو إخفاء هويتها."
                ]
            },
            rights: {
                title: "7. حقوقك",
                content: [
                    "يمكنك طلب الوصول إلى بياناتك، أو تصحيحها، أو حذفها، أو تقييد استخدامها حسب القوانين السارية.",
                    "للتواصل بشأن هذه الحقوق، راسلنا على privacy@kachabity.com أو عبر بيانات الاتصال الواردة في الشروط والأحكام.",
                    "نلتزم بالرد على الطلبات الموثقة خلال فترة زمنية معقولة."
                ]
            },
            security: {
                title: "8. الأمان",
                content: [
                    "نطبق ضوابط إدارية وفنية لحماية معلوماتك من الوصول أو التعديل غير المصرح به.",
                    "لا توجد وسيلة إلكترونية آمنة بنسبة 100٪؛ يرجى التواصل معنا إذا ساورك الشك بوجود نشاط غير مصرح به."
                ]
            },
            updates: {
                title: "9. تحديث السياسة",
                content: [
                    "قد نقوم بتحديث سياسة الخصوصية لتلبية المتطلبات القانونية أو التشغيلية.",
                    "سيتم نشر أي تغييرات مهمة على الموقع. استمرار استخدامك يعني موافقتك على النسخة المحدثة."
                ]
            }
        }
    }
});

export default function PrivacyPolicyPage() {
    const pathname = usePathname();
    const locale = pathname?.split("/")[1] || "en";
    const validLocale = ["en", "fr", "ar"].includes(locale) ? locale : "en";

    const content = getContent();
    const text = content[validLocale] || content.en;

    return (
        <>
            <main className="min-h-screen bg-surface">
                <section className="border-b border-line bg-card">
                    <div className="max-w-7xl mx-auto px-4 py-16 text-center">
                        <h1 className="text-3xl md:text-4xl font-bold text-ink mb-4">{text.title}</h1>
                        <p className="text-mute max-w-2xl mx-auto">{text.subtitle}</p>
                        <p className="text-sm text-mute mt-4">
                            {text.lastUpdated}:{" "}
                            {new Date().toLocaleDateString(
                                validLocale === "ar" ? "ar-TN" : validLocale === "fr" ? "fr-FR" : "en-US",
                                {
                                    year: "numeric",
                                    month: "long",
                                    day: "numeric"
                                }
                            )}
                        </p>
                    </div>
                </section>

                <section className="max-w-7xl mx-auto px-4 py-12">
                    {Object.entries(text.sections).map(([key, section], index) => (
                        <TermsSection
                            key={key}
                            title={section.title}
                            content={section.content}
                            isFirst={index === 0}
                        />
                    ))}
                </section>
            </main>
        </>
    );
}


