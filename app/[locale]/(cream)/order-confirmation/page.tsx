"use client";

import { useLanguage } from "@/lib/language-context";
import Link from "next/link";
import { headerConfig } from "@/lib/config";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const content = {
    en: {
        title: "Order Confirmed!",
        thankYou: "Thank you for your purchase",
        orderNumber: "Order Number",
        confirmation: "A confirmation email has been sent to your email address",
        whatNext: "What's Next?",
        tracking: "You'll receive tracking information once your order ships",
        questions: "Have questions?",
        contactUs: "Contact our support team",
        continueShopping: "Continue Shopping",
        viewOrder: "View Order Details",
        createAccountTitle: "Want to track your order?",
        createAccountDesc: "Create an account to easily track your orders and checkout faster next time",
        createAccountButton: "Create Account",
        loading: "Loading..."
    },
    fr: {
        title: "Commande confirmée!",
        thankYou: "Merci pour votre achat",
        orderNumber: "Numéro de commande",
        confirmation: "Un email de confirmation a été envoyé à votre adresse email",
        whatNext: "Et maintenant?",
        tracking: "Vous recevrez les informations de suivi une fois votre commande expédiée",
        questions: "Des questions?",
        contactUs: "Contactez notre équipe support",
        continueShopping: "Continuer vos achats",
        viewOrder: "Voir les détails de la commande",
        createAccountTitle: "Voulez-vous suivre votre commande?",
        createAccountDesc: "Créez un compte pour suivre facilement vos commandes et payer plus rapidement la prochaine fois",
        createAccountButton: "Créer un compte",
        loading: "Chargement..."
    },
    ar: {
        title: "تم تأكيد الطلب!",
        thankYou: "شكراً لك على الشراء",
        orderNumber: "رقم الطلب",
        confirmation: "تم إرسال رسالة تأكيد إلى بريدك الإلكتروني",
        whatNext: "ما التالي؟",
        tracking: "ستتلقى معلومات التتبع عند شحن طلبك",
        questions: "لديك أسئلة؟",
        contactUs: "اتصل بفريق الدعم",
        continueShopping: "متابعة التسوق",
        viewOrder: "عرض تفاصيل الطلب",
        createAccountTitle: "هل تريد تتبع طلبك؟",
        createAccountDesc: "أنشئ حساباً لتتبع طلباتك بسهولة والدفع بشكل أسرع في المرة القادمة",
        createAccountButton: "إنشاء حساب",
        loading: "جاري التحميل..."
    }
};

function OrderConfirmationContent() {
    const { locale } = useLanguage();
    const searchParams = useSearchParams();
    const orderNumber = searchParams.get('order') || 'N/A';
    const text = content[locale as keyof typeof content] || content.en;

    return (
        <div className="min-h-screen bg-surface flex items-center justify-center p-4">
            <div className="max-w-2xl w-full">
                <div className="bg-card rounded-2xl shadow-xl p-8 md:p-12 text-center">
                    {/* Success Icon */}
                    <div className="mb-6">
                        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                    </div>

                    {/* Title */}
                    <h1 className="text-3xl md:text-4xl font-bold text-ink mb-2">
                        {text.title}
                    </h1>
                    <p className="text-lg text-mute mb-8">
                        {text.thankYou}
                    </p>

                    {/* Order Number */}
                    <div className="bg-surface rounded-lg p-6 mb-8">
                        <p className="text-sm text-mute mb-1">{text.orderNumber}</p>
                        <p className="text-2xl font-bold text-ink font-mono">#{orderNumber.toUpperCase()}</p>
                    </div>

                    {/* Confirmation Message */}
                    <div className="mb-8">
                        <div className="flex items-start gap-3 text-left bg-blue-50 p-4 rounded-lg mb-6">
                            <svg className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            <p className="text-sm text-blue-900">
                                {text.confirmation}
                            </p>
                        </div>

                        {/* What's Next */}
                        <div className="text-left">
                            <h2 className="font-bold text-ink mb-3">{text.whatNext}</h2>
                            <ul className="space-y-2 text-mute">
                                <li className="flex items-start gap-2">
                                    <svg className="w-5 h-5 text-green-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span className="text-sm">{text.tracking}</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <svg className="w-5 h-5 text-green-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span className="text-sm">{text.questions} {text.contactUs}</span>
                                </li>
                            </ul>
                        </div>
                    </div>

                    {/* Create Account CTA */}
                    <div className="mb-8 p-6 bg-linear-to-r from-accent/10 to-accent/5 rounded-lg border border-accent/20">
                        <h3 className="text-lg font-bold text-ink mb-2">{text.createAccountTitle}</h3>
                        <p className="text-sm text-mute mb-4">{text.createAccountDesc}</p>
                        <Link
                            href={`/${locale}/auth?order=${orderNumber}`}
                            className="inline-block px-6 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition font-medium"
                        >
                            {text.createAccountButton}
                        </Link>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link
                            href={`/${locale}`}
                            className="px-8 py-3 bg-accent text-white rounded-lg hover:bg-accent-hover transition font-medium"
                        >
                            {text.continueShopping}
                        </Link>
                        <button
                            onClick={() => window.print()}
                            className="px-8 py-3 border-2 border-line text-ink rounded-lg hover:bg-surface transition font-medium"
                        >
                            {text.viewOrder}
                        </button>
                    </div>

                    {/* Support */}
                    <div className="mt-8 pt-8 border-t">
                        <p className="text-sm text-mute">
                            {text.questions}
                        </p>
                        <a href={`tel:${headerConfig.contact.phone.replace(/\s/g, '')}`} dir="ltr" className="text-accent hover:text-accent font-medium">
                            {headerConfig.contact.phone}
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function OrderConfirmationPage() {
    const { locale } = useLanguage();
    const text = content[locale as keyof typeof content] || content.en;

    return (
        <>
            <Suspense fallback={<div>{text.loading}</div>}>
                <OrderConfirmationContent />
            </Suspense>
        </>
    );
}

