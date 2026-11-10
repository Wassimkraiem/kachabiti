"use client";

import { useState, use } from "react";
import { useForm } from "react-hook-form";
import { FormInput, FormTextarea } from "@/components/forms";
import { headerConfig } from "@/lib/config";
import Image from "next/image";

type Locale = "en" | "fr" | "ar";

const content: Record<Locale, {
    title: string;
    subtitle: string;
    getInTouch: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    message: string;
    placeholderMessage: string;
    send: string;
    contactUs: string;
    location: string;
    phoneLabel: string;
    success: string;
    error: string;
    home: string;
    emailPlaceholder: string;
    phonePlaceholder: string;
    contactUsTitle: string;
    weLoveToHear: string;
}> = {
    en: {
        title: "Contact Us",
        subtitle: "Our friendly team would love to hear from you!",
        getInTouch: "Get in touch",
        firstName: "First Name",
        lastName: "Last Name",
        email: "Email",
        phone: "Phone",
        message: "Message",
        placeholderMessage: "How can we help you?",
        send: "Send message",
        contactUs: "Also Connect With Social Media To Anytime",
        location: "Location",
        phoneLabel: "Phone",
        success: "Thanks! Your message has been sent.",
        error: "Something went wrong. Please try again.",
        home: "Home",
        emailPlaceholder: "you@company.com",
        phonePlaceholder: "+216 XX XXX XXX",
        contactUsTitle: "Contact Us",
        weLoveToHear: "We'd love to hear from you"
    },
    fr: {
        title: "Contactez-nous",
        subtitle: "Notre équipe sympathique serait ravie de vous entendre !",
        getInTouch: "Entrer en contact",
        firstName: "Prénom",
        lastName: "Nom",
        email: "Email",
        phone: "Téléphone",
        message: "Message",
        placeholderMessage: "Comment pouvons-nous vous aider ?",
        send: "Envoyer le message",
        contactUs: "Nous serions ravis d'avoir de vos nouvelles",
        location: "Adresse",
        phoneLabel: "Téléphone",
        success: "Merci ! Votre message a été envoyé.",
        error: "Une erreur est survenue. Veuillez réessayer.",
        home: "Accueil",
        emailPlaceholder: "vous@entreprise.com",
        phonePlaceholder: "+216 XX XXX XXX",
        contactUsTitle: "Contactez-nous",
        weLoveToHear: "Nous serions ravis d'avoir de vos nouvelles"
    },
    ar: {
        title: "اتصل بنا",
        subtitle: "يسعد فريقنا أن نسمع منك!",
        getInTouch: "تواصل معنا",
        firstName: "الاسم",
        lastName: "اللقب",
        email: "البريد الإلكتروني",
        phone: "الهاتف",
        message: "الرسالة",
        placeholderMessage: "كيف يمكننا مساعدتك؟",
        send: "إرسال الرسالة",
        contactUs: "يسعدنا سماعك",
        location: "العنوان",
        phoneLabel: "الهاتف",
        success: "شكرًا! تم إرسال رسالتك.",
        error: "حدث خطأ. يرجى المحاولة مرة أخرى.",
        home: "الرئيسية",
        emailPlaceholder: "you@company.com",
        phonePlaceholder: "+216 XX XXX XXX",
        contactUsTitle: "اتصل بنا",
        weLoveToHear: "يسعدنا سماعك"
    }
};

export default function ContactPage({ params }: { params: Promise<{ locale: Locale }> }) {
    const { locale: rawLocale } = use(params);
    const locale: Locale = ["en", "fr", "ar"].includes(rawLocale as string) ? (rawLocale as Locale) : "en";
    const text = content[locale];
    const mapAddress = encodeURIComponent(headerConfig.contact.location);

    type ContactFormData = {
        firstName: string;
        lastName: string;
        email: string;
        phone?: string;
        message: string;
    };

    const { register, handleSubmit, reset, formState: { errors } } = useForm<ContactFormData>();
    const [submitting, setSubmitting] = useState(false);
    const [status, setStatus] = useState<{ type: "success" | "error" | null; message: string }>({ type: null, message: "" });

    const onSubmit = async (data: ContactFormData) => {
        setSubmitting(true);
        setStatus({ type: null, message: "" });
        try {
            const res = await fetch("/api/contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...data, locale })
            });
            if (res.ok) {
                setStatus({ type: "success", message: text.success });
                reset();
            } else {
                setStatus({ type: "error", message: text.error });
            }
        } catch (err) {
            setStatus({ type: "error", message: text.error });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="min-h-screen bg-card">

            <section className="bg-surface border-b border-neutral-200">

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                    <div className="flex items-start justify-between">
                        <div>
                            <h1 className="text-2xl font-semibold text-accent">{text.title}</h1>
                            <p className="text-sm text-neutral-600 mt-2 max-w-xl">{text.subtitle}</p>
                        </div>
                        <p className="text-sm text-neutral-500">{text.home}/ {text.title}</p>
                    </div>
                </div>
            </section>

            <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="bg-card p-6 rounded-lg border border-neutral-200">
                        <h2 className="text-lg font-medium text-neutral-900 mb-6">{text.getInTouch}</h2>
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <FormInput
                                    label={text.firstName}
                                    name={"firstName"}
                                    placeholder={text.firstName}
                                    register={register}
                                    error={errors.firstName}
                                    required
                                />
                                <FormInput
                                    label={text.lastName}
                                    name={"lastName"}
                                    placeholder={text.lastName}
                                    register={register}
                                    error={errors.lastName}
                                    required
                                />
                            </div>
                            <FormInput
                                label={text.email}
                                name={"email"}
                                type="email"
                                placeholder={text.emailPlaceholder}
                                register={register}
                                error={errors.email}
                                required
                            />
                            <FormInput
                                label={text.phone}
                                name={"phone"}
                                type="tel"
                                placeholder={text.phonePlaceholder}
                                register={register}
                                error={errors.phone as any}
                            />
                            <FormTextarea
                                label={text.message}
                                name={"message"}
                                placeholder={text.placeholderMessage}
                                register={register}
                                error={errors.message}
                                required
                            />

                            {status.type && (
                                <p className={`text-sm ${status.type === "success" ? "text-green-600" : "text-red-600"}`}>{status.message}</p>
                            )}

                            <button type="submit" disabled={submitting} className="w-full bg-accent hover:bg-accent-hover text-white rounded-md px-4 py-2 transition-colors disabled:opacity-60">
                                {submitting ? "..." : text.send}
                            </button>
                        </form>
                    </div>

                    <div className="rounded-lg overflow-hidden border border-neutral-200 ">
                        <iframe
                            title="map"
                            src={`https://www.google.com/maps?q=${mapAddress}&output=embed`}
                            className="w-full h-full"
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                        />
                    </div>
                </div>

                <div className="mt-12">
                    <div className="flex flex-col items-center gap-2 mb-15 ">
                        <h3 className="text-ink">{text.contactUsTitle}</h3>
                        <h2 className="text-ink text-[32px]">{text.weLoveToHear}</h2>
                        <h3 className="text-center text-sm text-neutral-600">{text.contactUs}</h3>
                    </div>
                    <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="rounded-[15]  p-6 bg-card">

                            <div
                                className="w-14 h-14 mb-[9] rounded-full bg-accent  flex items-center justify-center transition-colors group"
                            >
                                <Image
                                    src={'/assets/images/contact/MapPin.png'}
                                    alt={headerConfig.contact.address}
                                    height={17}
                                    width={17}
                                />
                            </div>
                            <div className="text-ink font-semibold">{text.location}</div>
                            <p className="text-sm text-neutral-600 mt-2">{headerConfig.contact.address}.</p>
                        </div>
                        <div className="rounded-xl bg-card p-6">


                            <div
                                className="w-14 h-14  mb-[9] rounded-full bg-accent  flex items-center justify-center transition-colors group"
                            >
                                <Image
                                    src={'/assets/images/contact/Phone.png'}
                                    alt={headerConfig.contact.phone}
                                    height={17}
                                    width={17}
                                />
                            </div>
                            <div className="text-ink font-semibold">{text.phoneLabel}</div>
                            <p className="text-sm text-neutral-600 mt-2">{headerConfig.contact.phone}</p>
                        </div>
                    </div>
                </div>
            </section>

        </main>
    );
}


