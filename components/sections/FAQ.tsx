"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import SectionHeader from "../ui/SectionHeader";
import { isRTL } from "@/lib/language-utils";

const translations = {
    en: {
        title: "Frequently Asked Questions",
        questions: [
            {
                question: "What is قشابِـيتي?",
                answer: "قشابِـيتي is the first and largest online platform for traditional Tunisian handcrafted products. We offer a wide range of authentic handmade items including traditional clothing, accessories, and home decor, all crafted by skilled artisans across Tunisia. Our mission is to preserve and promote traditional craftsmanship while making it accessible to customers worldwide."
            },
            {
                question: "How do I place an order?",
                answer: "Placing an order is easy! Simply browse our products, add items to your cart, and proceed to checkout. You'll need to provide your shipping information and payment details. Once your order is confirmed, you'll receive an email confirmation with your order details."
            },
            {
                question: "What shipping options are available?",
                answer: "We currently deliver within Tunisia. Shipping costs are shown at checkout, and orders are delivered within 48 hours after confirmation."
            },
            {
                question: "How can I track my order?",
                answer: "Once your order has been shipped, you'll receive a tracking number via email. You can use this tracking number to monitor your package's progress on our website or the shipping carrier's website."
            },
            {
                question: "What is your return policy?",
                answer: "We accept returns within 14 days of delivery for items in their original condition. Please contact our customer service team to initiate a return. Items must be unworn, unwashed, and in their original packaging. Custom or personalized items may not be eligible for return."
            },
            {
                question: "Are your products 100% handmade?",
                answer: "Yes! All our products are 100% handmade by skilled artisans. We work directly with craftspeople across Tunisia to ensure authenticity and quality. Each piece is unique and crafted with traditional techniques passed down through generations."
            }
        ]
    },
    fr: {
        title: "Questions Fréquemment Posées",
        questions: [
            {
                question: "Qu'est-ce que قشابِـيتي?",
                answer: "قشابِـيتي est la première et la plus grande plateforme en ligne pour les produits artisanaux tunisiens traditionnels. Nous offrons une large gamme d'articles authentiques faits à la main, notamment des vêtements traditionnels, des accessoires et des décorations d'intérieur, tous fabriqués par des artisans qualifiés à travers la Tunisie. Notre mission est de préserver et de promouvoir l'artisanat traditionnel tout en le rendant accessible aux clients du monde entier."
            },
            {
                question: "Comment passer une commande?",
                answer: "Passer une commande est facile ! Parcourez simplement nos produits, ajoutez des articles à votre panier et passez à la caisse. Vous devrez fournir vos informations de livraison et vos coordonnées de paiement. Une fois votre commande confirmée, vous recevrez un email de confirmation avec les détails de votre commande."
            },
            {
                question: "Quelles options d'expédition sont disponibles?",
                answer: "Nous livrons actuellement en Tunisie. Les frais sont affichés lors du paiement et les commandes sont livrées sous 48 heures après confirmation."
            },
            {
                question: "Comment puis-je suivre ma commande?",
                answer: "Une fois votre commande expédiée, vous recevrez un numéro de suivi par email. Vous pouvez utiliser ce numéro de suivi pour suivre la progression de votre colis sur notre site Web ou sur le site Web du transporteur."
            },
            {
                question: "Quelle est votre politique de retour?",
                answer: "Nous acceptons les retours dans les 14 jours suivant la livraison pour les articles dans leur état d'origine. Veuillez contacter notre équipe de service client pour initier un retour. Les articles doivent être non portés, non lavés et dans leur emballage d'origine. Les articles personnalisés ou personnalisés peuvent ne pas être éligibles au retour."
            },
            {
                question: "Vos produits sont-ils 100% faits à la main?",
                answer: "Oui ! Tous nos produits sont 100% faits à la main par des artisans qualifiés. Nous travaillons directement avec des artisans à travers la Tunisie pour garantir l'authenticité et la qualité. Chaque pièce est unique et fabriquée avec des techniques traditionnelles transmises de génération en génération."
            }
        ]
    },
    ar: {
        title: "الأسئلة المتكررة",
        questions: [
            {
                question: "ماهي منصة قشابِـيتي؟",
                answer: "قشابِـيتي هي أول وأكبر منصة إلكترونية للمنتجات الحرفية التونسية التقليدية. نقدم مجموعة واسعة من المنتجات الحرفية الأصيلة بما في ذلك الملابس التقليدية والإكسسوارات وديكور المنزل، كلها مصنوعة يدوياً من قبل حرفيين مهرة في جميع أنحاء تونس. مهمتنا هي الحفاظ على الحرف التقليدية وتعزيزها مع جعلها في متناول العملاء في جميع أنحاء العالم."
            },
            {
                question: "كيف أسجل طلبية؟",
                answer: "تسجيل الطلبية سهل! ببساطة تصفح منتجاتنا، أضف العناصر إلى سلة التسوق، وانتقل إلى الدفع. ستحتاج إلى تقديم معلومات الشحن وتفاصيل الدفع. بمجرد تأكيد طلبك، ستتلقى رسالة تأكيد بالبريد الإلكتروني مع تفاصيل طلبك."
            },
            {
                question: "ما هي خيارات الشحن المتاحة؟",
                answer: "نوصّل حالياً داخل تونس فقط. تظهر تكلفة التوصيل عند إتمام الطلب، ويتم التوصيل خلال 48 ساعة من تأكيد الطلب."
            },
            {
                question: "كيف يمكنني تتبع طلبيتي؟",
                answer: "بمجرد شحن طلبك، ستتلقى رقم تتبع عبر البريد الإلكتروني. يمكنك استخدام رقم التتبع هذا لمراقبة تقدم طردك على موقعنا الإلكتروني أو موقع شركة الشحن."
            },
            {
                question: "ما هي سياسة الإرجاع الخاصة بكم؟",
                answer: "نقبل الإرجاع خلال 14 يوماً من التسليم للعناصر في حالتها الأصلية. يرجى الاتصال بفريق خدمة العملاء لدينا لبدء عملية الإرجاع. يجب أن تكون العناصر غير مستعملة وغير مغسولة وفي عبوتها الأصلية. قد لا تكون العناصر المخصصة أو الشخصية مؤهلة للإرجاع."
            },
            {
                question: "هل منتجاتكم 100% مصنوعة يدوياً؟",
                answer: "نعم! جميع منتجاتنا مصنوعة يدوياً 100% من قبل حرفيين مهرة. نعمل مباشرة مع الحرفيين في جميع أنحاء تونس لضمان الأصالة والجودة. كل قطعة فريدة ومصنوعة بتقنيات تقليدية تم نقلها عبر الأجيال."
            }
        ]
    }
};

interface FAQItemProps {
    question: string;
    answer: string;
    isOpen: boolean;
    onToggle: () => void;
    rtl: boolean;
}

function FAQItem({ question, answer, isOpen, onToggle, rtl }: FAQItemProps) {
    return (
        <div className="bg-card rounded-lg border border-line overflow-hidden transition-all duration-300">
            <button
                onClick={onToggle}
                className={` w-full px-6 py-4 flex items-center justify-between text-left transition-colors duration-200 ${isOpen ? 'bg-card' : 'hover:bg-surface'
                    }`}
                aria-expanded={isOpen}
            >
                <div className="flex items-center gap-4 flex-1">
                    <div
                        className={`w-1 h-8 bg-accent rounded transition-all duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'} ${rtl ? 'order-last' : ''}`}
                    ></div>
                    <span className={`font-medium transition-colors duration-200 ${isOpen ? 'text-accent' : 'text-ink'} ${rtl ? 'text-right' : 'text-left'}`}>
                        {question}
                    </span>
                </div>
                <svg
                    className={`w-5 h-5 text-mute shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''
                        } ${rtl ? 'order-1' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'}`}
            >
                <div className={`px-6 py-4 ${rtl ? 'text-right' : 'text-left'}`}>
                    <p className="text-ink leading-relaxed">{answer}</p>
                </div>
            </div>
        </div>
    );
}

export default function FAQ() {
    const params = useParams();
    const locale = (params?.locale as string) || 'en';
    const t = translations[locale as keyof typeof translations] || translations.en;
    const rtl = isRTL(locale);

    const [openIndex, setOpenIndex] = useState<number | null>(null); // All items closed initially

    const toggleItem = (index: number) => {
        setOpenIndex(openIndex === index ? null : index);
    };

    // Handle scroll to FAQ section when hash is present
    useEffect(() => {
        if (typeof window !== 'undefined') {
            // Check if URL has #faqs hash
            if (window.location.hash === '#faqs') {
                // Small delay to ensure DOM is ready
                setTimeout(() => {
                    const faqSection = document.getElementById('faqs');
                    if (faqSection) {
                        faqSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }, 100);
            }
        }
    }, []);

    return (
        <section id="faqs" className="w-full py-16 px-4 bg-card" dir={rtl ? 'rtl' : 'ltr'}>
            <div className="max-w-4xl mx-auto">
                <SectionHeader
                    title={t.title}
                />

                <div className="space-y-4">
                    {t.questions.map((faq, index) => (
                        <FAQItem
                            key={index}
                            question={faq.question}
                            answer={faq.answer}
                            isOpen={openIndex === index}
                            onToggle={() => toggleItem(index)}
                            rtl={rtl}
                        />
                    ))}
                </div>
            </div>
        </section>
    );
}
