interface CarouselIndicatorsProps {
    totalSlides: number;
    currentSlide: number;
    onSlideChange: (index: number) => void;
    activeColor?: string;
    inactiveColor?: string;
    className?: string;
}

export default function CarouselIndicators({ 
    totalSlides, 
    currentSlide, 
    onSlideChange,
    activeColor = "bg-accent",
    inactiveColor = "bg-line",
    className = ""
}: CarouselIndicatorsProps) {
    return (
        <div className={`flex justify-center gap-2 mb-12 ${className}`}>
            {Array.from({ length: totalSlides }).map((_, index) => (
                <button
                    key={index}
                    onClick={() => onSlideChange(index)}
                    className={`w-2.5 h-2.5 rounded-full transition-colors ${
                        currentSlide === index ? activeColor : inactiveColor
                    }`}
                    aria-label={`Go to slide ${index + 1}`}
                    aria-current={currentSlide === index ? "true" : "false"}
                />
            ))}
        </div>
    );
}

