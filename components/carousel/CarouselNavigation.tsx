interface CarouselNavigationProps {
    onPrevious: () => void;
    onNext: () => void;
    className?: string;
}

export default function CarouselNavigation({
    onPrevious,
    onNext,
    className = ""
}: CarouselNavigationProps) {
    return (
        <div className={`flex justify-end gap-3 mb-8 text-ink ${className}`}>
            <button
                onClick={onPrevious}
                className="flex items-center gap-2 px-6 py-2.5 border border-line rounded-lg hover:bg-surface transition-colors"
                aria-label="Previous slide"
            >
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-medium">Previous</span>
            </button>
            <button
                onClick={onNext}
                className="flex items-center gap-2 px-6 py-2.5 border border-line rounded-lg hover:bg-surface transition-colors"
                aria-label="Next slide"
            >
                <span className="text-sm font-medium">Next</span>
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
            </button>
        </div>
    );
}

