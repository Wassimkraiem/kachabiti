"use client";

import { usePathname } from "next/navigation";
import TermsSection from "@/components/sections/TermsSection";
import { headerConfig } from "@/lib/config";

interface ShippingContent {
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

const getContent = (): Record<string, ShippingContent> => ({
    en: {
        title: "Shipping Policy",
        subtitle: "Everything you need to know about delivery timelines, costs, and how we get your order to you.",
        lastUpdated: "Last updated",
        sections: {
            overview: {
                title: "1. Overview",
                content: [
                    "This Shipping Policy explains how Kachabity processes, prepares, and delivers orders placed through our website.",
                    "Please read together with our Terms & Conditions and Returns Policy for a complete understanding of the order journey."
                ]
            },
            coverage: {
                title: "2. Coverage & Processing",
                content: [
                    "We currently ship throughout Tunisia. Orders placed before 3:00 PM TST (Monday–Friday) enter processing on the same business day. Orders placed after that time or on weekends/holidays are processed the next business day.",
                    "Processing includes order verification, product quality check, and secure packaging. Custom or made-to-measure items may require additional handling time; we will notify you if that occurs."
                ]
            },
            deliveryTimes: {
                title: "3. Estimated Delivery Times",
                content: [
                    "Orders are delivered within 48 hours after confirmation. Delivery may be affected by exceptional weather, carrier capacity, or public holidays; we will inform you of any material delay."
                ]
            },
            fees: {
                title: "4. Shipping Fees & Free Delivery Threshold",
                content: [
                    "Standard shipping fees are calculated at checkout based on destination and parcel weight.",
                    "Orders exceeding the free-shipping threshold published on our website qualify for complimentary delivery. The threshold may change during promotions; please refer to the latest announcement.",
                    "Cash-on-delivery (COD) fees, where applicable, are included in the shipping charge shown at checkout."
                ]
            },
            tracking: {
                title: "5. Order Tracking",
                content: [
                    "Once your order ships, we send a confirmation email or SMS with tracking information (when supported by the carrier).",
                    "If tracking is unavailable, our support team can provide delivery updates by phone at " + headerConfig.contact.phone + "."
                ]
            },
            deliveryIssues: {
                title: "6. Delivery Attempts & Issues",
                content: [
                    "Carriers generally make up to two delivery attempts. If delivery fails, the parcel may be held at a local depot for pickup or returned to us.",
                    "If a package is returned due to an incorrect address or repeated failed delivery attempts, we will contact you to arrange re-delivery. Additional shipping fees may apply.",
                    "Please inspect your parcel upon arrival. If items are missing or damaged, notify us within 48 hours with photos and your order number so we can assist promptly."
                ]
            },
            international: {
                title: "7. International Shipping",
                content: [
                    "We do not currently ship internationally. If you are interested in international delivery, please contact us—your feedback helps us prioritize future expansions."
                ]
            },
            changes: {
                title: "8. Updates to This Policy",
                content: [
                    "We reserve the right to update this Shipping Policy to reflect changes in carriers, costs, or logistics processes.",
                    "Any updates take effect upon posting to the website. Continuing to place orders after updates constitutes acceptance of the revised policy."
                ]
            }
        }
    },
    fr: {
        title: "Politique d'Expédition",
        subtitle: "Toutes les informations sur les délais de livraison, les frais et l’acheminement de votre commande.",
        lastUpdated: "Dernière mise à jour",
        sections: {
            overview: {
                title: "1. Aperçu",
                content: [
                    "Cette Politique d'Expédition explique comment Kachabity prépare et livre les commandes passées sur son site.",
                    "Veuillez la lire en complément des Termes & Conditions et de la Politique de Retours."
                ]
            },
            coverage: {
                title: "2. Zone Couvertes & Traitement",
                content: [
                    "Nous livrons actuellement dans toute la Tunisie. Les commandes passées avant 15h00 (du lundi au vendredi) sont traitées le jour même. Celles passées après 15h00 ou durant le week-end sont traitées le jour ouvrable suivant.",
                    "Le traitement comprend la vérification de la commande, le contrôle qualité et l'emballage sécurisé. Les pièces sur mesure peuvent nécessiter un délai supplémentaire."
                ]
            },
            deliveryTimes: {
                title: "3. Délais Estimés",
                content: [
                    "Les commandes sont livrées sous 48 heures après confirmation. Le délai peut être affecté par des conditions météo exceptionnelles, la capacité des transporteurs ou les jours fériés ; nous vous informerons de tout retard important."
                ]
            },
            fees: {
                title: "4. Frais d'Expédition & Seuil de Gratuité",
                content: [
                    "Les frais standards sont calculés lors du paiement en fonction de la destination et du poids du colis.",
                    "Les commandes dépassant le seuil de livraison gratuite indiqué sur notre site bénéficient de la livraison offerte (selon les conditions en vigueur).",
                    "Les éventuels frais de paiement à la livraison sont inclus dans le montant affiché lors du paiement."
                ]
            },
            tracking: {
                title: "5. Suivi de Commande",
                content: [
                    "Une fois la commande expédiée, un e-mail ou un SMS de confirmation avec un lien de suivi est envoyé (si le transporteur le permet).",
                    "Si le suivi n'est pas disponible, notre équipe support peut vous informer par téléphone au " + headerConfig.contact.phone + "."
                ]
            },
            deliveryIssues: {
                title: "6. Tentatives & Problèmes de Livraison",
                content: [
                    "Les transporteurs effectuent généralement jusqu'à deux tentatives de livraison. En cas d'échec, le colis peut être conservé dans un point relais ou nous être retourné.",
                    "Si un colis est retourné en raison d'une adresse incorrecte ou après plusieurs tentatives, nous vous contacterons pour organiser une nouvelle expédition (des frais supplémentaires peuvent s'appliquer).",
                    "Veuillez vérifier votre colis dès réception. En cas de produit manquant ou endommagé, contactez-nous sous 48 heures avec votre numéro de commande et des photos."
                ]
            },
            international: {
                title: "7. Livraison Internationale",
                content: [
                    "La livraison internationale n'est pas disponible pour le moment. Faites-le nous savoir si vous souhaitez une expédition à l'étranger afin que nous puissions évaluer la demande."
                ]
            },
            changes: {
                title: "8. Mises à Jour",
                content: [
                    "Nous pouvons mettre à jour cette Politique d'Expédition pour refléter des changements logistiques ou tarifaires.",
                    "Les modifications prennent effet dès leur publication sur le site. En continuant à commander, vous acceptez la version à jour."
                ]
            }
        }
    },
    ar: {
        title: "سياسة الشحن",
        subtitle: "جميع المعلومات المتعلقة بمدة التوصيل والتكاليف وكيفية وصول طلبك إليك.",
        lastUpdated: "آخر تحديث",
        sections: {
            overview: {
                title: "1. نظرة عامة",
                content: [
                    "تشرح سياسة الشحن هذه كيفية معالجة قشابِـيتي للطلبات وتحضيرها وتوصيلها.",
                    "يرجى قراءة هذه السياسة مع الشروط والأحكام وسياسة الإرجاع لفهم كامل لرحلة الطلب."
                ]
            },
            coverage: {
                title: "2. نطاق الخدمة والمعالجة",
                content: [
                    "نقوم بالشحن حاليًا داخل تونس. الطلبات المقدمة قبل الساعة 15:00 (من الاثنين إلى الجمعة) يتم معالجتها في نفس اليوم. الطلبات المقدمة بعد ذلك أو خلال عطلة نهاية الأسبوع تُعالج في يوم العمل التالي.",
                    "تشمل مرحلة المعالجة التحقق من الطلب، وفحص الجودة، والتغليف الآمن. الطلبات المخصصة قد تحتاج إلى وقت إضافي؛ سنبلغك في حال حدوث ذلك."
                ]
            },
            deliveryTimes: {
                title: "3. أوقات التوصيل المتوقعة",
                content: [
                    "يتم توصيل الطلبات خلال 48 ساعة من تأكيدها. قد يتأثر التوصيل بالظروف الجوية الاستثنائية أو ضغط شركات الشحن أو العطل الرسمية، وسنبلغكم بأي تأخير مهم."
                ]
            },
            fees: {
                title: "4. رسوم الشحن وحد الشحن المجاني",
                content: [
                    "يتم احتساب رسوم الشحن عند إتمام الطلب بناءً على الوجهة ووزن الطرد.",
                    "الطلبات التي تتجاوز حد الشحن المجاني المنشور على موقعنا تستفيد من التوصيل المجاني (وفق الشروط المعلنة).",
                    "في حال تطبيق رسوم الدفع عند الاستلام، يتم تضمينها ضمن رسوم الشحن الظاهرة عند إنهاء الطلب."
                ]
            },
            tracking: {
                title: "5. متابعة الطلب",
                content: [
                    "عند شحن الطلب، نرسل رسالة تأكيد عبر البريد الإلكتروني أو SMS مرفقة بمعلومات التتبع (عند توفرها من شركة الشحن).",
                    "إذا كان التتبع غير متاح، يمكن لفريق الدعم تزويدك بالتحديثات عبر الهاتف " + headerConfig.contact.phone + "."
                ]
            },
            deliveryIssues: {
                title: "6. محاولات التسليم والمشكلات",
                content: [
                    "تقوم شركات الشحن عادةً بمحاولتين للتسليم. في حالة الفشل، قد يُحفظ الطرد في نقطة استلام أو يُعاد إلينا.",
                    "إذا أُعيد الطرد بسبب عنوان غير صحيح أو تكرار فشل التسليم، سنتواصل معك لترتيب التسليم من جديد وقد تُفرض رسوم إضافية.",
                    "يرجى فحص الطرد فور استلامه. في حال وجود نقص أو تلف، أخبرنا خلال 48 ساعة مع رقم الطلب والصور."
                ]
            },
            international: {
                title: "7. الشحن الدولي",
                content: [
                    "الشحن الدولي غير متاح حاليًا. إذا كنت مهتمًا بإرسال الطلبات إلى الخارج، الرجاء إبلاغنا بذلك للمساعدة في تحديد أولويات التوسع."
                ]
            },
            changes: {
                title: "8. تحديثات السياسة",
                content: [
                    "نحتفظ بالحق في تحديث سياسة الشحن بما يتوافق مع تغييرات الشركاء أو التكاليف أو العمليات.",
                    "تصبح التحديثات سارية بمجرد نشرها على الموقع. استمرار تقديم الطلبات يعني الموافقة على السياسة المحدّثة."
                ]
            }
        }
    }
});

export default function ShippingPolicyPage() {
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

