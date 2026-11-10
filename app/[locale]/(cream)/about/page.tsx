"use client";

import { use } from "react";
import { headerConfig } from "@/lib/config";
import Image from "next/image";

type Locale = "en" | "fr" | "ar";
type CoFounder = {
    name: string;
    role: string;
    description: string;
    image: string;
};

type LocaleContent = {
    title: string;
    subtitle: string;
    sectionTitle: string;
    sectionDescription: string;
    mainHeading: string;
    mainDescription1: string;
    mainDescription2: string;
    coFounderTitle: string;
    coFounderSubtitle: string;
    coFounders: CoFounder[];
    excellentCoFounders: string;
    coFoundersDescription: string;
};


const content: Record<Locale, LocaleContent & { home: string }> = {
    en: {
        title: "About Us",
        subtitle: "Reviving the soul of tradition through handcrafted clothing.",
        home: "Home",
        sectionTitle: "Our Story ",
        sectionDescription: [
            "Kachabity was born in Khniss, a small town in Monastir, Tunisia, where craftsmanship is more than a profession , it is a way of life. For generations, the art of traditional weaving has been an essential part of both the identity and the economy of Khniss.",
            "Our story begins with Mounir Kraiem, a dedicated teacher deeply connected to his roots. Despite his career in education, he never gave up his craft. In his free time, he continues to weave, preserving the ancestral art with love and pride.",
            "From this heritage, his son, Wael Kraiem, a computer engineer, learned the craft from his father at a young age. As he grew, he sought to develop it further, adding a modern and digital touch that gives it a youthful spirit and a contemporary dimension, without losing its essence.",
            "Thus, Kachabity was born , a bridge between heritage, innovation, and the digital world.",
            "Although young in age, Kachabity carries the wisdom of ancestors and the spirit of authentic Tunisian identity.",
            "Our mission is to preserve the authentic Kachabity while presenting it anew with a modern, digital, and creative touch."
        ].join(" "),
        mainHeading: "A Revival of Heritage",
        mainDescription1:
            "Kachabity is more than just a brand , it’s a revival of our roots. We celebrate the timeless art of traditional and handmade clothing, crafted with love and care by the hands of our grandparents generations ago. These pieces carry stories, memories, and the beauty of our heritage.",
        mainDescription2:
            "Kachabity was born to honor that legacy , to preserve, recreate, and bring back to life the authentic craftsmanship that once defined our culture. Through every stitch and fabric, we reconnect the past with the present — keeping our traditions alive for generations to come.",
        coFounderTitle: "Our Co-founders",
        coFounderSubtitle: "Inspired by heritage, driven by passion.",
        excellentCoFounders: "Our Excellent Co-founders",
        coFoundersDescription: "Together, Mounir Kraiem and Wael Kraiem blend decades of craftsmanship with forward-looking innovation, guiding Kachabity with heart, heritage, and vision.",
        coFounders: [
            {
                name: "Mounir Kraiem",
                image: '/assets/images/about/founder2.jpeg',
                role: "Co-Founder",
                description:
                    "Mounir is passionate about preserving ancestral heritage and works to ensure that every Kachabity piece carries the story and soul of our grandparents.",
            },
            {
                name: "Wael Kraiem",
                role: "Co-Founder",
                image: '/assets/images/about/founder1.jpg',

                description:
                    "Wael believes in the timeless beauty of handmade craftsmanship and leads Kachabity with a vision to blend tradition with contemporary design.",
            },

        ],
    },
    fr: {
        title: "À propos de nous",
        subtitle: "Faire revivre l'âme du patrimoine à travers des vêtements faits main.",
        home: "Accueil",
        sectionTitle: "Notre Histoire",
        sectionDescription: [
            "Kachabity est née à Khniss, une petite ville de Monastir, en Tunisie, où l'artisanat est plus qu'une profession, c'est un mode de vie. Depuis des générations, l'art du tissage traditionnel fait partie intégrante de l'identité et de l'économie de Khniss.",
            "Notre histoire commence avec Mounir Kraiem, un enseignant dévoué profondément attaché à ses racines. Malgré sa carrière dans l'éducation, il n'a jamais abandonné son métier. Dans son temps libre, il continue à tisser, préservant l'art ancestral avec amour et fierté.",
            "De cet héritage, son fils, Wael Kraiem, ingénieur en informatique, a appris le métier de son père dès son plus jeune âge. En grandissant, il a cherché à le développer davantage, ajoutant une touche moderne et numérique qui lui donne un esprit jeune et une dimension contemporaine, sans perdre son essence.",
            "Ainsi, Kachabity est née, un pont entre le patrimoine, l'innovation et le monde numérique.",
            "Bien que jeune en âge, Kachabity porte la sagesse des ancêtres et l'esprit de l'identité tunisienne authentique.",
            "Notre mission est de préserver le Kachabity authentique tout en le présentant à nouveau avec une touche moderne, numérique et créative."
        ].join(" "),
        mainHeading: "Une renaissance du patrimoine",
        mainDescription1:
            "Kachabity n’est pas qu’une simple marque — c’est une renaissance de nos racines. Nous rendons hommage à l’art intemporel des vêtements traditionnels et faits main, créés avec amour et soin par nos grandparents il y a des générations. Chaque pièce porte une histoire, une mémoire et la beauté de notre héritage.",
        mainDescription2:
            "Kachabity est née pour honorer cet héritage — préserver, recréer et redonner vie à l’artisanat authentique qui définissait autrefois notre culture. À travers chaque fil et chaque tissu, nous reconnectons le passé au présent, pour que nos traditions continuent de vivre à travers le temps.",
        coFounderTitle: "Nos co-fondateurs",
        coFounderSubtitle: "Inspirés par le patrimoine, guidés par la passion.",
        excellentCoFounders: "Nos excellents co-fondateurs",
        coFoundersDescription: "Ensemble, Mounir Kraiem et Wael Kraiem allient des décennies de savoir-faire artisanal à une innovation tournée vers l'avenir, guidant Kachabity avec cœur, patrimoine et vision.",
        coFounders: [
            {
                name: "Mounir Kraiem",
                image: '/assets/images/about/founder2.jpeg',

                role: "Co-fondateur",
                description:
                    "Passionné par la préservation du patrimoine ancestral, Mounir veille à ce que chaque pièce Kachabity raconte une histoire authentique et vivante.",
            },
            {
                name: "Wael Kraiem",
                role: "Co-fondateur",
                image: '/assets/images/about/founder1.jpg',

                description:
                    "Wael croit en la beauté intemporelle du savoir-faire artisanal et dirige Kachabity avec une vision qui allie tradition et modernité.",
            },

        ],
    },
    ar: {
        title: "من نحن",
        subtitle: "نُحيي روح التراث من خلال الأزياء التقليدية واليدوية.",
        home: "الرئيسية",
        sectionTitle: "قصتنا",
        sectionDescription: [
            "وُلدت قشابِـيتي في الخنيس، بلدة صغيرة في المنستير، تونس، حيث الحرفية ليست مجرد مهنة، بل هي أسلوب حياة. منذ أجيال، كان فن النسيج التقليدي جزءًا أساسيًا من هوية واقتصاد الخنيس.",
            "تبدأ قصتنا مع منير كريم معلم مخلص مرتبط بعمق بجذوره. رغم مسيرته في التعليم، لم يتخلَّ أبدًا عن حرفته. في وقت فراغه، يستمر في النسيج، محافظًا على الفن الأصيل بحب وفخر.",
            "من هذا التراث، تعلم ابنه وائل كريم مهندس كمبيوتر، الحرفة من والده في سن مبكرة. مع نموه، سعى لتطويرها أكثر، مضيفًا لمسة عصرية ورقمية تعطيها روحًا شابة وبعدًا معاصرًا، دون فقدان جوهرها.",
            "وهكذا وُلدت قشابِـيتي، جسر بين التراث والابتكار والعالم الرقمي.",
            "رغم صغر سنها، تحمل قشابِـيتي حكمة الأجداد وروح الهوية التونسية الأصيلة.",
            "مهمتنا هي الحفاظ على قشابِـيتي الأصيلة مع تقديمها من جديد بلمسة عصرية ورقمية وإبداعية."
        ].join(" "),
        mainHeading: "إحياء للتراث والأصالة",
        mainDescription1:
            "قشابِـيتي ليست مجرد علامة تجارية، بل هي إحياء لجذورنا. نُكرّم الفنّ العريق في صناعة الملابس التقليدية واليدوية، التي أبدعها جدودنا بكل حبّ وإتقان منذ أجيال. هذه القطع تحمل في خيوطها قصصًا وذكريات وجمالًا من ماضينا.",
        mainDescription2:
            "وُلدت قشابِـيتي لتُورّث الحرفة وتُعيد الحياة للصناعات التقليدية الأصيلة التي ميّزت ثقافتنا. من خلال كل غرزة ونسيج، نربط الماضي بالحاضر ونُبقي تراثنا حيًّا للأجيال القادمة.",
        coFounderTitle: "المؤسسان المشاركان",
        coFounderSubtitle: "مستوحَيان من التراث، مدفوعان بالشغف.",
        excellentCoFounders: "المؤسسان المتميزان",
        coFoundersDescription: "معًا، يجمع منير كريم ووائل كريم بين عقود من الحرفية والابتكار المتطلع إلى المستقبل، يقودان قشابِـيتي بقلب وتراث ورؤية.",
        coFounders: [
            {
                name: "منير كريم",
                role: "المؤسس المشارك",
                image: '/assets/images/about/founder2.jpeg',

                description:
                    "شغوف بالحفاظ على التراث الأصيل، ويسعى منير لأن تحمل كل قطعة من قشابِـيتي روح الأجداد وحكايتهم.",
            },
            {
                name: "وائل كريم",
                role: "المؤسس المشارك",
                image: '/assets/images/about/founder1.jpg',

                description:
                    "يؤمن وائل بجمال الحرفة اليدوية وأصالتها، ويقود قشابِـيتي برؤية تمزج بين التراث والتصميم العصري.",
            },

        ],
    },
};

const HIGHLIGHT_TERMS = ["Kachabity", "Qchabity", "Khniss", "Mounir Kraiem", "Wael Kraiem"];

function renderHighlighted(text: string) {
    const parts = text.split(new RegExp(`(${HIGHLIGHT_TERMS.join("|")})`, "g"));
    return parts.map((part, index) =>
        HIGHLIGHT_TERMS.includes(part)
            ? <span key={`${part}-${index}`} className="font-semibold">{part}</span>
            : <span key={`text-${index}`}>{part}</span>
    );
}


export default function AboutPage({ params }: { params: Promise<{ locale: Locale }> }) {
    const { locale: rawLocale } = use(params);
    const locale: Locale = ["en", "fr", "ar"].includes(rawLocale as string) ? (rawLocale as Locale) : "en";
    const text = content[locale];

    return (
        <main className="min-h-screen bg-card">

            {/* Hero Section */}
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

            {/* About Our Artisan Shop Section */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
                <div className="text-center mb-12">
                    <h2 className="text-2xl font-semibold text-ink mb-4">{text.sectionTitle}</h2>
                    <p className="text-neutral-600 max-w-6xl mx-auto">
                        {renderHighlighted(text.sectionDescription)}
                    </p>
                </div>

                {/* Main Content Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-20">
                    {/* Image Column */}
                    <div className="relative">
                        <Image
                            src="/assets/images/logoKachabity.jpg"
                            alt="Kachabity team collaboration"
                            width={600}
                            height={400}
                            className="rounded-lg object-cover w-full h-full"
                        />
                    </div>

                    {/* Text Column */}
                    <div className="space-y-6">
                        <h3 className="text-xl font-semibold text-ink leading-relaxed">
                            {text.mainHeading}
                        </h3>
                        <div className="space-y-4 text-neutral-700 leading-relaxed">
                            <p>{text.mainDescription1}</p>
                            <p>{text.mainDescription2}</p>
                        </div>
                    </div>
                </div>
                <div className=" flex flex-col justify-center items-center gap-4">
                    <h3 className="text-ink">{text.excellentCoFounders}</h3>

                    <p className="text-mute text-center max-w-2xl">
                        {renderHighlighted(text.coFoundersDescription)}
                    </p>
                    <Image
                        src={'/assets/images/about/signature.svg'}
                        alt={'signature_image'}
                        width={88}
                        height={34}
                    // className="object-cover rounded-[15px]"
                    />
                </div>
                {/* Co-founder Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 justify-center">
                    {text.coFounders.map((founder) => (
                        <div key={founder.name} className="flex flex-col items-center">
                            <div className="w-48 h-48   mb-6  ">
                                <Image
                                    src={founder.image}
                                    alt={founder.name}
                                    width={192}
                                    height={192}
                                    className="object-cover w-full h-full rounded-[15px]"
                                />
                                <div className="w-full -top-11 relative bg-card text-white px-6 py-2 rounded-b-lg mb-2 inline-block">
                                    <p className="font-semibold text-lg">{founder.name}</p>
                                </div>
                            </div>



                            <p className="text-accent font-medium mb-4">{founder.role}</p>

                            <p className="text-neutral-600 max-w-md mb-6 text-center">{founder.description}</p>


                        </div>
                    ))}


                </div>
                <div className="flex space-x-2 items-center justify-center">
                    {Object.entries(headerConfig.social).map(([platform, data]) => (

                        <a
                            key={platform}
                            href={data.url}
                            target="_blank"
                            rel="noopener noreferrer"

                            className="w-14 h-14 rounded-full bg-surface hover:bg-accent flex items-center justify-center transition-colors group"

                            aria-label={`Follow us on ${platform}`}
                        >
                            <svg className="w-6 h-6 text-accent group-hover:text-white transition-colors" fill="currentColor" viewBox="0 0 24 24">
                                <path d={data.icon} />
                            </svg>
                        </a>
                    ))}
                </div>
            </section>

        </main>
    );
}

