"use client";

import { useEffect, useState } from 'react';

interface CountdownTimerProps {
    targetDate: Date | number;
}

export default function CountdownTimer({ targetDate }: CountdownTimerProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <div className="flex gap-2 items-center">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="flex flex-col items-center">
                        <div className="text-2xl font-bold text-ink w-12 h-8 bg-line animate-pulse rounded" />
                        <div className="text-xs text-mute mt-1 w-8 h-3 bg-line animate-pulse rounded" />
                    </div>
                ))}
            </div>
        );
    }

    const deadline = typeof targetDate === 'number' ? targetDate : targetDate.getTime();

    return (
        <div className="flex gap-2 items-center">
            <CountdownDisplay deadline={deadline} />
        </div>
    );
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
                        <div className="flex flex-col bg-surface rounded-md px-2.5 py-2 min-w-[82px] min-h-[80px] items-center justify-center">
                            <span className="text-[24px] font-medium text-ink">
                                {String(unit.value).padStart(2, '0')}
                            </span>
                            <span className="text-[20px] text-ink font-light">
                                {unit.label}
                            </span>
                        </div>
                    </div>
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

