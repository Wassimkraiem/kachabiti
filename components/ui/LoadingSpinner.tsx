interface LoadingSpinnerProps {
    message?: string;
    fullPage?: boolean;
}

// The header and footer come from app/[locale]/layout.tsx, so this renders only the spinner.
export default function LoadingSpinner({
    message = "Loading...",
    fullPage = true,
}: LoadingSpinnerProps) {
    return (
        <div className={`${fullPage ? 'min-h-screen' : 'min-h-[400px]'} bg-card flex items-center justify-center`}>
            <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-accent"></div>
                <p className="mt-4 text-mute">{message}</p>
            </div>
        </div>
    );
}
