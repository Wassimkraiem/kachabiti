interface SectionHeaderProps {
    title: string;
    subtitle?: string;
    className?: string;
}

export default function SectionHeader({ title, subtitle, className = "" }: SectionHeaderProps) {
    return (
        <div className={`text-center mb-12 ${className}`}>
            <h2 className="font-display text-3xl font-bold text-ink mb-2 sm:text-4xl">
                {title}
            </h2>
            {subtitle && (
                <p className="text-mute text-base">
                    {subtitle}
                </p>
            )}
        </div>
    );
}

