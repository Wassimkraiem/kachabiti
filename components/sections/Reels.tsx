"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useParams } from "next/navigation";

const translations = {
    en: {
        title: "Featured Videos"
    },
    fr: {
        title: "Vidéos En Vedette"
    },
    ar: {
        title: "فيديوهاتنا المميزة"
    }
};

interface Reel {
    id: string;
    title: string;
    description?: string | null;
    username: string;
    thumbnail_url: string;
    video_url: string;
    sort_order: number;
    active: boolean;
    is_new?: boolean;
}

// Extract YouTube video ID from URL
const getYouTubeId = (url: string): string | null => {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
};

// Extract TikTok video ID from URL
const getTikTokId = (url: string): string | null => {
    if (!url) return null;
    const regExp = /tiktok\.com\/.*\/video\/(\d+)/;
    const match = url.match(regExp);
    return match ? match[1] : null;
};

// Extract Facebook video URL for embedding
const getFacebookEmbedUrl = (url: string): string | null => {
    if (!url || !url.includes('facebook.com')) return null;
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&width=734`;
};

// Detect video platform
const detectVideoPlatform = (url: string): { platform: 'youtube' | 'tiktok' | 'facebook' | 'other', embedUrl: string | null } => {
    if (!url) return { platform: 'other', embedUrl: null };

    const youtubeId = getYouTubeId(url);
    if (youtubeId) {
        return { platform: 'youtube', embedUrl: `https://www.youtube.com/embed/${youtubeId}?autoplay=1` };
    }

    const tiktokId = getTikTokId(url);
    if (tiktokId) {
        return { platform: 'tiktok', embedUrl: `https://www.tiktok.com/embed/v2/${tiktokId}` };
    }

    const facebookEmbedUrl = getFacebookEmbedUrl(url);
    if (facebookEmbedUrl) {
        return { platform: 'facebook', embedUrl: facebookEmbedUrl };
    }

    return { platform: 'other', embedUrl: null };
};

export default function Reels({ initialReels }: { initialReels?: Reel[] }) {
    const params = useParams();
    const locale = (params?.locale as string) || 'en';
    const t = translations[locale as keyof typeof translations] || translations.en;
    const [reels, setReels] = useState<Reel[]>(initialReels ?? []);
    const [selectedVideo, setSelectedVideo] = useState<{ embedUrl: string, platform: string } | null>(null);
    const sliderRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        async function fetchReels() {
            try {
                const response = await fetch("/api/reels");
                const result = await response.json();
                if (result.success && result.data) {
                    setReels(result.data);
                }
            } catch (error) {
                console.error("Error fetching reels:", error);
            }
        }

        if (!initialReels) fetchReels();
    }, [initialReels]);

    const handleVideoClick = (url: string | null) => {
        if (!url) return;
        const videoInfo = detectVideoPlatform(url);
        if (videoInfo.embedUrl) {
            setSelectedVideo({ embedUrl: videoInfo.embedUrl, platform: videoInfo.platform });
        } else {
            // Fallback to opening in new tab if platform is not supported
            window.open(url, '_blank');
        }
    };

    const scrollLeft = () => {
        if (sliderRef.current) {
            sliderRef.current.scrollBy({ left: -400, behavior: 'smooth' });
        }
    };

    const scrollRight = () => {
        if (sliderRef.current) {
            sliderRef.current.scrollBy({ left: 400, behavior: 'smooth' });
        }
    };

    if (reels.length === 0) {
        return null;
    }

    return (
        <>
            <section className="w-full py-16 px-0 bg-gradient-to-b from-card via-card to-card overflow-hidden">
                <div className="max-w-[1600px] mx-auto">
                    {/* Section Title with Decorative Elements */}
                    <div className="text-center mb-12 px-4">
                        <div className="inline-flex items-center gap-3 mb-3">
                            <div className="w-12 h-[2px] bg-gradient-to-r from-transparent to-[#d4a574]"></div>
                            <svg className="w-6 h-6 text-accent" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                            <div className="w-12 h-[2px] bg-gradient-to-l from-transparent to-[#d4a574]"></div>
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold text-ink mb-2">
                            {t.title}
                        </h2>
                        <p className="text-accent/70 text-sm md:text-base">
                            Discover our latest stories and products
                        </p>
                    </div>

                    {/* Slider Container with Floating Effect */}
                    <div className="relative px-2 md:px-8 lg:px-12">
                        {/* Left Arrow - Premium Design */}
                        {reels.length > 1 && (
                            <button
                                onClick={scrollLeft}
                                className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-12 h-12 bg-card hover:bg-surface rounded-full shadow-xl hover:shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 border-2 border-[#d4a574]/30 hover:border-accent/50 backdrop-blur-sm"
                                aria-label="Previous"
                            >
                                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>
                        )}

                        {/* Videos Grid - Seamless Wide Design */}
                        <div
                            ref={sliderRef}
                            className="flex gap-3 overflow-x-auto scroll-smooth hide-scrollbar py-6 px-2"
                            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                        >
                            {reels.map((reel, index) => {
                                const videoId = getYouTubeId(reel.video_url);
                                const youtubeThumbnail = videoId
                                    ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
                                    : reel.thumbnail_url;

                                return (
                                    <div
                                        key={reel.id}
                                        className="flex-shrink-0 w-[200px] sm:w-[220px] md:w-[240px] lg:w-[260px] transform transition-all duration-500"
                                    >
                                        {/* Premium Floating Card - Enhanced Design */}
                                        <div className="relative group/card">
                                            {/* Animated Background Glow */}
                                            <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-br from-[#d4a574] via-[#7a3b2e] to-[#5a2b1e] opacity-75 group-hover/card:opacity-100 blur-[2px] group-hover/card:blur-[3px] transition-all duration-500"></div>

                                            <div className="relative p-[2px] rounded-2xl bg-gradient-to-br from-[#d4a574] via-[#7a3b2e] to-[#5a2b1e] shadow-xl hover:shadow-2xl transition-all duration-500 hover:-translate-y-3">
                                                <div
                                                    className="relative group cursor-pointer rounded-2xl overflow-hidden bg-black"
                                                    onClick={() => handleVideoClick(reel.video_url)}
                                                >
                                                    {/* Inner Border Shine Effect */}
                                                    <div className="absolute inset-0 rounded-2xl border border-white/10 z-10 pointer-events-none"></div>
                                                    <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none z-10">
                                                        <div className="absolute top-0 left-0 right-0 h-1/3 bg-gradient-to-b from-white/10 to-transparent"></div>
                                                    </div>

                                                    {/* Vertical Thumbnail */}
                                                    <div className="relative aspect-[9/16] bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
                                                        <Image
                                                            src={youtubeThumbnail}
                                                            alt={reel.title}
                                                            fill
                                                            className="object-cover transition-transform duration-500 group-hover:scale-110"
                                                        />

                                                        {/* Elegant Gradient Overlay */}
                                                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

                                                        {/* Animated Border Glow Effect */}
                                                        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                                                            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#d4a574]/20 via-[#7a3b2e]/20 to-[#5a2b1e]/20" />
                                                        </div>

                                                        {/* Premium Play Button with Pulse Animation */}
                                                        <div className="absolute inset-0 flex items-center justify-center">
                                                            {/* Pulsing Ring Effect */}
                                                            <div className="absolute w-20 h-20 rounded-full bg-white/20 animate-ping opacity-75"></div>

                                                            {/* Play Button */}
                                                            <div className="relative w-16 h-16 bg-gradient-to-br from-card via-card to-card rounded-full flex items-center justify-center shadow-2xl transform group-hover:scale-125 transition-all duration-500 ring-4 ring-white/40 group-hover:ring-8 group-hover:ring-white/60">
                                                                {/* Inner Glow */}
                                                                <div className="absolute inset-1 rounded-full bg-gradient-to-br from-[#d4a574]/20 to-transparent"></div>

                                                                {/* Play Icon */}
                                                                <svg className="relative w-7 h-7 text-accent ml-1 drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24">
                                                                    <path d="M8 5v14l11-7z" />
                                                                </svg>
                                                            </div>
                                                        </div>

                                                        {/* Premium Badge - Only show if is_new is true */}
                                                        {reel.is_new && (
                                                            <div className="absolute top-3 right-3 z-10">
                                                                <div className="bg-gradient-to-r from-[#d4a574] to-[#7a3b2e] text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-lg">
                                                                    ✨ NEW
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Video Info Overlay - Premium Design */}
                                                        <div className="absolute bottom-0 left-0 right-0 p-4 backdrop-blur-md bg-gradient-to-t from-black/80 via-black/50 to-transparent">
                                                            {/* Username Badge with Kachabiti Logo */}
                                                            <div className="flex items-center gap-2 mb-3">
                                                                <div className="relative">
                                                                    {/* Avatar Glow */}
                                                                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[#d4a574] to-[#7a3b2e] blur-md opacity-75"></div>

                                                                    {/* Kachabiti Logo Avatar */}
                                                                    <div className="relative w-10 h-10 rounded-full bg-card flex items-center justify-center ring-2 ring-white/60 shadow-xl overflow-hidden">
                                                                        <Image
                                                                            src="/assets/images/logoKachabitybg.png"
                                                                            alt="Kachabiti"
                                                                            width={40}
                                                                            height={40}
                                                                            className="object-cover w-full h-full"
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <span className="text-white text-sm font-bold drop-shadow-2xl tracking-wide">
                                                                    {reel.username}
                                                                </span>
                                                            </div>

                                                            {/* Title */}
                                                            <h3 className="text-white text-base font-bold mb-1.5 line-clamp-2 leading-tight drop-shadow-2xl">
                                                                {reel.title}
                                                            </h3>

                                                            {/* Description */}
                                                            {reel.description && (
                                                                <p className="text-white/95 text-sm line-clamp-2 drop-shadow-lg leading-relaxed">
                                                                    {reel.description}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Right Arrow - Premium Design */}
                        {reels.length > 1 && (
                            <button
                                onClick={scrollRight}
                                className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-12 h-12 bg-card hover:bg-surface rounded-full shadow-xl hover:shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 border-2 border-[#d4a574]/30 hover:border-accent/50 backdrop-blur-sm"
                                aria-label="Next"
                            >
                                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>
            </section>

            <style jsx>{`
                .hide-scrollbar::-webkit-scrollbar {
                    display: none;
                }
            `}</style>

            {/* Video Modal - Vertical Reel Style */}
            {selectedVideo && (
                <div
                    className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4"
                    onClick={() => setSelectedVideo(null)}
                >
                    <div className="relative w-full  max-w-md aspect-[9/16]">
                        <button
                            onClick={() => setSelectedVideo(null)}
                            className="absolute -top-12 right-0 text-white hover:text-mute transition-colors"
                            aria-label="Close"
                        >
                            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <iframe
                            className="w-full h-full rounded-xl"
                            src={selectedVideo.embedUrl}
                            title={`${selectedVideo.platform} video player`}
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                        />
                    </div>
                </div>
            )}
        </>
    );
}

