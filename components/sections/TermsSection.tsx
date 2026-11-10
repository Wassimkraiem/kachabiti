interface TermsSectionProps {
    title: string;
    content: string[];
    isFirst?: boolean;
}

export default function TermsSection({ title, content, isFirst = false }: TermsSectionProps) {
    return (
        <section className="mb-12">
            <h2 className={`text-2xl font-semibold text-ink mb-6 pb-3 ${isFirst ? '' : ''}`}>
                {title}
            </h2>
            {content.map((paragraph, index) => (
                <p key={index} className="text-mute leading-relaxed mb-4">
                    {paragraph}
                </p>
            ))}
        </section>
    );
}


