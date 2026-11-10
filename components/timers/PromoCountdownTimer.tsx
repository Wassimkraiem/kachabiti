"use client";

import { useEffect, useState } from 'react';

interface PromoCountdownTimerProps {
    targetDate: Date | number;
}

export default function PromoCountdownTimer({ targetDate }: PromoCountdownTimerProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <div className="flex items-center gap-1.5">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                        <div className="flex flex-col items-center gap-1">
                            <div className="bg-line rounded-md px-2.5 py-2 min-w-[45px] h-[40px] animate-pulse" />
                            <div className="w-6 h-3 bg-line rounded animate-pulse" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    const deadline = typeof targetDate === 'number' ? targetDate : targetDate.getTime();

    return <CountdownDisplay deadline={deadline} />;
}

function CountdownDisplay({ deadline }: { deadline: number }) {
    const [timeLeft, setTimeLeft] = useState(calculateTimeLeft(deadline));

    useEffect(() => {
        const timer = setInterval(() => {
            setTimeLeft(calculateTimeLeft(deadline));
        }, 1000);

        return () => clearInterval(timer);
    }, [deadline]);

    const timeUnits = [
        { value: timeLeft.days, label: 'Day' },
        { value: timeLeft.hours, label: 'Hour' },
        { value: timeLeft.minutes, label: 'Min' },
        { value: timeLeft.seconds, label: 'Sec' }
    ];

    return (
        <div className="flex items-center gap-1.5">
            {timeUnits.map((unit, index) => (
                <div key={index} className="flex items-center gap-1.5">
                    <div className="flex flex-col items-center gap-1">
                        <div className="bg-surface rounded-md px-2.5 py-2 min-w-[45px] flex items-center justify-center">
                            <span className="text-[16px] font-semibold text-ink">
                                {String(unit.value).padStart(2, '0')}
                            </span>
                        </div>
                        <span className="text-[10px] text-mute font-medium">
                            {unit.label}
                        </span>
                    </div>
                    {index < timeUnits.length - 1 && (
                        <span className="text-[16px] font-semibold text-ink -mt-5">:</span>
                    )}
                </div>
            ))}
        </div>
    );
}

function calculateTimeLeft(deadline: number) {
    const difference = deadline - Date.now();

    if (difference <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    }

    return {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60)
    };
}

