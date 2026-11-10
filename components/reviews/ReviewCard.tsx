"use client";

import Image from "next/image";

interface User {
    id: string;
    name: string;
    email?: string;
    avatar_url?: string;
}

interface Review {
    id: string;
    user_id: string;
    rating: number;
    comment: string;
    created_at?: string;
    users?: User;
}

interface ReviewCardProps {
    review: Review;
}

export default function ReviewCard({ review }: ReviewCardProps) {
    const userName = review.users?.name || 'Anonymous';
    const avatarUrl = review.users?.avatar_url;

    const renderStars = (rating: number) => {
        return (
            <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                    <svg
                        key={star}
                        className={`w-6 h-6 ${star <= rating ? 'text-[#FFA800] fill-[#FFA800]' : 'text-mute fill-none'
                            }`}
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="1.5"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                        />
                    </svg>
                ))}
            </div>
        );
    };

    const getAvatarColor = (name: string) => {
        const colors = ['#FFD700', '#87CEEB', '#98FB98'];
        const index = name.charCodeAt(0) % colors.length;
        return colors[index];
    };

    return (
        <div className="rounded-[5px] h-[300px] p-6 border border-line">
            {/* Avatar and Stars */}
            <div className="flex items-center justify-between">
                {avatarUrl ? (
                    <div className="w-16 h-16 rounded-lg mb-4 overflow-hidden">
                        <Image
                            src={avatarUrl}
                            alt={userName}
                            width={64}
                            height={64}
                            className="object-cover w-full h-full"
                        />
                    </div>
                ) : (
                    <div
                        className="w-16 h-16 rounded-lg mb-4 flex items-center justify-center text-2xl font-bold text-white"
                        style={{ backgroundColor: getAvatarColor(userName) }}
                    >
                        {userName.charAt(0).toUpperCase()}
                    </div>
                )}

                <div className="mb-4">
                    {renderStars(review.rating)}
                </div>
            </div>

            {/* Name */}
            <h3 className="text-lg font-semibold text-ink mb-3 capitalize">
                {userName}
            </h3>

            {/* Comment */}
            <p className="text-[16px] font-light tracking-[2px] text-ink leading-relaxed">
                {review.comment}
            </p>
        </div>
    );
}

