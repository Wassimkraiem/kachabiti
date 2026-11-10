import { isRTL } from "@/lib/language-utils";
import { reemKufi } from "@/lib/fonts";
import { headerConfig } from "@/lib/config";

const CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "TND";

const translations = {
    en: {
        title: "How ordering works",
        steps: (threshold: number | null) => [
            { title: "Pick your piece", text: "Choose the model, colour and size on the product page." },
            { title: "Place your order", text: "Fill in your address at checkout. It takes a couple of minutes." },
            {
                title: "We deliver to you",
                text: threshold !== null
                    ? `Delivery is free on orders from ${threshold} ${CURRENCY}.`
                    : "Your order is shipped to the address you gave.",
            },
            { title: "Pay on arrival", text: "You pay in cash when the parcel reaches you." },
        ],
        helpTitle: "Not sure about your size?",
        helpText: "Call us and we'll help you choose before you order.",
    },
    fr: {
        title: "Comment commander",
        steps: (threshold: number | null) => [
            { title: "Choisissez votre pièce", text: "Sélectionnez le modèle, la couleur et la taille sur la fiche produit." },
            { title: "Passez commande", text: "Indiquez votre adresse au moment de valider. Cela prend deux minutes." },
            {
                title: "Nous livrons chez vous",
                text: threshold !== null
                    ? `La livraison est offerte dès ${threshold} ${CURRENCY} d'achat.`
                    : "Votre commande est expédiée à l'adresse indiquée.",
            },
            { title: "Payez à la réception", text: "Vous réglez en espèces à l'arrivée du colis." },
        ],
        helpTitle: "Un doute sur la taille ?",
        helpText: "Appelez-nous, nous vous aidons à choisir avant de commander.",
    },
    ar: {
        title: "كيف تطلب",
        steps: (threshold: number | null) => [
            { title: "اختر قطعتك", text: "اختر الموديل واللون والمقاس من صفحة المنتج." },
            { title: "أكّد طلبك", text: "أدخل عنوانك عند إتمام الطلب. لا يستغرق الأمر سوى دقيقتين." },
            {
                title: "نوصل إليك",
                text: threshold !== null
                    ? `التوصيل مجاني للطلبات التي تتجاوز ${threshold} ${CURRENCY}.`
                    : "نرسل طلبك إلى العنوان الذي حددته.",
            },
            { title: "ادفع عند الاستلام", text: "تدفع نقداً عند وصول الطرد إليك." },
        ],
        helpTitle: "لست متأكداً من المقاس؟",
        helpText: "اتصل بنا وسنساعدك على الاختيار قبل الطلب.",
    },
};

interface HowToOrderProps {
    locale: string;
    freeShippingThreshold: number | null;
}

export default function HowToOrder({ locale, freeShippingThreshold }: HowToOrderProps) {
    const t = translations[locale as keyof typeof translations] || translations.en;
    const phone = headerConfig.contact.phone;
    const steps = t.steps(freeShippingThreshold);

    return (
        <section dir={isRTL(locale) ? "rtl" : "ltr"} className={`${reemKufi.variable} w-full bg-surface px-4 py-16`}>
            <div className="mx-auto max-w-7xl">
                <h2 className="text-start font-[family-name:var(--font-kufi)] text-3xl font-bold text-ink sm:text-4xl">
                    {t.title}
                </h2>

                <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] lg:gap-12">
                    <ol className="stagger grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
                        {steps.map((step, index) => (
                            <li key={step.title} className="border-t-2 border-accent/40 pt-5 text-start">
                                <span
                                    className="font-[family-name:var(--font-kufi)] text-4xl font-bold leading-none text-accent"
                                    aria-hidden="true"
                                >
                                    {index + 1}
                                </span>
                                <h3 className="mt-3 font-semibold text-ink">{step.title}</h3>
                                <p className="mt-1.5 text-sm leading-relaxed text-mute">{step.text}</p>
                            </li>
                        ))}
                    </ol>

                    <div className="rounded-[14px] border border-line bg-card p-6 text-start text-ink">
                        <p className="font-[family-name:var(--font-kufi)] text-xl font-semibold">{t.helpTitle}</p>
                        <p className="mt-2 text-sm leading-relaxed text-ink/75">{t.helpText}</p>
                        <a
                            href={`tel:${phone.replace(/\s/g, "")}`}
                            dir="ltr"
                            className="mt-5 inline-block rounded-full bg-ink px-5 py-2.5 font-semibold text-surface transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
                        >
                            {phone}
                        </a>
                    </div>
                </div>
            </div>
        </section>
    );
}
