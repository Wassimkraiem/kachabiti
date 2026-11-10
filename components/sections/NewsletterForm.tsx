"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

interface NewsletterFormProps {
    title: string;
    subtitle?: string;
    placeholder?: string;
}

const translations = {
    en: {
        enterEmail: "Please enter your email",
        validEmail: "Please enter a valid email address",
        subscribing: "Subscribing...",
        subscribe: "Subscribe",
        thankYou: "Thank you for subscribing!",
        somethingWrong: "Something went wrong. Please try again.",
        networkError: "Network error. Please try again."
    },
    fr: {
        enterEmail: "Veuillez entrer votre e-mail",
        validEmail: "Veuillez entrer une adresse e-mail valide",
        subscribing: "Abonnement...",
        subscribe: "S'abonner",
        thankYou: "Merci de vous être abonné!",
        somethingWrong: "Une erreur est survenue. Veuillez réessayer.",
        networkError: "Erreur réseau. Veuillez réessayer."
    },
    ar: {
        enterEmail: "يرجى إدخال بريدك الإلكتروني",
        validEmail: "يرجى إدخال عنوان بريد إلكتروني صحيح",
        subscribing: "جاري الاشتراك...",
        subscribe: "اشترك",
        thankYou: "شكراً لك على الاشتراك!",
        somethingWrong: "حدث خطأ. يرجى المحاولة مرة أخرى.",
        networkError: "خطأ في الشبكة. يرجى المحاولة مرة أخرى."
    }
};

export default function NewsletterForm({
    title,
    subtitle,
    placeholder = "Enter your email"
}: NewsletterFormProps) {
    const params = useParams();
    const locale = (params?.locale as string) || 'en';
    const t = translations[locale as keyof typeof translations] || translations.en;

    const [email, setEmail] = useState("");
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [message, setMessage] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!email) {
            setStatus("error");
            setMessage(t.enterEmail);
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setStatus("error");
            setMessage(t.validEmail);
            return;
        }

        setStatus("loading");

        try {
            const response = await fetch('/api/newsletter/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email }),
            });

            const data = await response.json();

            if (response.ok) {
                setStatus("success");
                setMessage(data.message || t.thankYou);
                setEmail("");

                setTimeout(() => {
                    setStatus("idle");
                    setMessage("");
                }, 5000);
            } else {
                setStatus("error");
                setMessage(data.error || t.somethingWrong);
            }
        } catch {
            setStatus("error");
            setMessage(t.networkError);
        }
    };

    return (
        <div>
            <h3 className="text-lg font-semibold text-ink mb-2">
                {title}
            </h3>
            {subtitle && (
                <p className="text-mute text-sm mb-4">
                    {subtitle}
                </p>
            )}
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={placeholder}
                    className="placeholder:text-mute min-w-0 flex-1 px-4 py-2.5 border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-sm"
                    disabled={status === "loading"}
                />
                <button
                    type="submit"
                    disabled={status === "loading"}
                    className="px-6 py-2.5 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                    {status === "loading" ? t.subscribing : t.subscribe}
                </button>
            </form>
            {message && (
                <p className={`mt-2 text-sm ${status === "success" ? "text-green-600" : "text-red-600"}`}>
                    {message}
                </p>
            )}
        </div>
    );
}