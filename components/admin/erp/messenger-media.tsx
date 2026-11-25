"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Empty, Image, Input, Modal, Spin, Typography } from "antd";
import { AudioOutlined, CustomerServiceOutlined, DeleteOutlined, PictureOutlined, SendOutlined, ShoppingOutlined, StopOutlined } from "@ant-design/icons";
import { message } from "@/components/admin/antd-app";
import { useAdminT } from "@/lib/admin-i18n";
import { api, useApi } from "./erp-client";

const { Text } = Typography;
const MAX_SECONDS = 120;
const WAV_RATE = 16_000;

const LABELS: Record<string, string> = { image: "Photo", audio: "Voice message", video: "Video" };

/** "[image]" stands for a message without text: shown as "Photo". */
export function messageText(body: string, t: (s: string) => string) {
    const types = /^\[(\w+(?:, \w+)*)\]$/.exec(body)?.[1].split(", ");
    return types ? [...new Set(types.map((x) => t(LABELS[x] ?? "Attachment")))].join(", ") : body;
}

/** The photos, audio and videos of a message. */
export function Attachments({ id, items }: { id: string; items?: { type: string }[] }) {
    const { t } = useAdminT();
    if (!items?.length) return null;
    return (
        <Image.PreviewGroup>
            {items.map((item, i) => {
                const src = `/api/crm/media?id=${id}&i=${i}`;
                if (item.type === "image") return <Image key={i} src={src} alt={t("Photo")} width={220} height={220} style={{ borderRadius: 10, objectFit: "cover" }} />;
                if (item.type === "audio") return <audio key={i} controls preload="none" src={src} aria-label={t("Voice message")} style={{ display: "block", width: 260, maxWidth: "100%" }} />;
                if (item.type === "video") return <video key={i} controls preload="metadata" src={src} aria-label={t("Video")} style={{ display: "block", width: 260, height: 200, maxWidth: "100%", borderRadius: 10 }} />;
                return <a key={i} href={src} target="_blank" rel="noopener noreferrer" style={{ display: "block", color: "inherit", textDecoration: "underline" }}>{t("Attachment")}</a>;
            })}
        </Image.PreviewGroup>
    );
}

/** Any photo the browser can read, as a JPEG of 1600 px at most (Meta refuses WebP, which the shop uses). */
async function toJpeg(blob: Blob): Promise<Blob> {
    try {
        const bitmap = await createImageBitmap(blob);
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#fff"; // JPEG has no transparency
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error())), "image/jpeg", 0.85));
    } catch {
        throw new Error("This photo can't be read.");
    }
}

/** Any sound the browser can play, as a mono 16 kHz WAV (recorders differ by browser; Meta reads WAV). */
async function toWav(blob: Blob): Promise<Blob> {
    const context = new AudioContext();
    const audio = await context.decodeAudioData(await blob.arrayBuffer())
        .catch(() => { throw new Error("This audio can't be read."); })
        .finally(() => void context.close());
    // +1 s: a recording stopped at the limit is a little longer.
    if (audio.duration > MAX_SECONDS + 1) throw new Error("Audio can last 2 minutes at most.");
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * WAV_RATE)), WAV_RATE);
    const source = offline.createBufferSource();
    source.buffer = audio;
    source.connect(offline.destination);
    source.start();
    const samples = (await offline.startRendering()).getChannelData(0);
    const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, WAV_RATE, true);
    view.setUint32(28, WAV_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true));
    return new Blob([view], { type: "audio/wav" });
}

interface Product { id: string; name: string; name_fr: string | null; name_ar: string | null; images: string[] }

/** Through the site's image optimizer: the same origin, so the canvas can read it. */
const optimized = (url: string, width: number) => `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=75`;

function ProductPicker({ onClose, onSend }: { onClose: () => void; onSend: (urls: string[]) => Promise<void> }) {
    const { t, locale } = useAdminT();
    const [q, setQ] = useState("");
    const [chosen, setChosen] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const { data, loading, error } = useApi<Product[]>(`/api/crm/media/products?q=${encodeURIComponent(q)}`);
    const toggle = (url: string) => setChosen((list) => (list.includes(url) ? list.filter((u) => u !== url) : list.length < 10 ? [...list, url] : list));
    return (
        <Modal
            open
            width={720}
            title={t("Send product photos")}
            onCancel={onClose}
            okText={t("Send {count} photo(s)", { count: chosen.length })}
            okButtonProps={{ disabled: !chosen.length, loading: busy }}
            cancelText={t("Cancel")}
            onOk={async () => { setBusy(true); await onSend(chosen); onClose(); }}
        >
            <Input.Search allowClear placeholder={t("Product name or code")} aria-label={t("Product name or code")} onSearch={(v) => setQ(v.trim())} style={{ marginBottom: 12 }} />
            {error && <Text type="danger">{t(error)}</Text>}
            {loading && !data && <Spin />}
            {data?.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("No product with a photo.")} />}
            <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
                {data?.map((p) => {
                    const name = (locale === "ar" ? p.name_ar : locale === "fr" ? p.name_fr : null) || p.name;
                    return (
                        <div key={p.id} style={{ marginBottom: 14 }}>
                            <div dir="auto" style={{ fontWeight: 600, marginBottom: 6 }}>{name}</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {[...new Set(p.images)].map((url, i) => {
                                    const on = chosen.includes(url);
                                    return (
                                        <button key={url} type="button" aria-pressed={on} aria-label={`${name} ${i + 1}`} onClick={() => toggle(url)}
                                            style={{ padding: 0, width: 88, height: 88, borderRadius: 10, overflow: "hidden", cursor: "pointer", background: "#f5f5f5", border: `3px solid ${on ? "#7a3b2e" : "transparent"}` }}>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={optimized(url, 256)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </Modal>
    );
}

/** Next to the message box: photos, product photos, audio file, voice message. */
export function MediaButtons({ customerId, channel, onSent }: { customerId: string; channel: string; onSent: () => Promise<void> }) {
    const { t } = useAdminT();
    const photos = useRef<HTMLInputElement>(null);
    const audio = useRef<HTMLInputElement>(null);
    const recorder = useRef<MediaRecorder | null>(null);
    const gone = useRef(false);
    const [picking, setPicking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [seconds, setSeconds] = useState<number | null>(null);
    const [recording, setRecording] = useState<{ blob: Blob; url: string } | null>(null);

    const upload = (file: Blob, name: string) => {
        const form = new FormData();
        form.append("customer_id", customerId);
        form.append("channel", channel);
        form.append("file", file, name);
        return api("/api/crm/media", { method: "POST", body: form });
    };
    const sendAll = async (files: (() => Promise<Blob>)[]) => {
        setBusy(true);
        let sent = 0;
        try {
            for (const file of files) {
                await upload(await toJpeg(await file()), "photo.jpg");
                sent++;
            }
        } catch (e) {
            message.error(t((e as Error).message));
            if (sent) message.warning(t("{sent} of {count} photos sent.", { sent, count: files.length }));
        }
        if (sent) await onSent();
        setBusy(false);
    };
    const sendAudio = async (blob: Blob) => {
        setBusy(true);
        try {
            await upload(await toWav(blob), "voice.wav");
            await onSent();
            return true;
        } catch (e) {
            message.error(t((e as Error).message));
            return false;
        } finally {
            setBusy(false);
        }
    };
    const record = async () => {
        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
            message.error(t("Allow the microphone in your browser to record."));
            return;
        }
        // The conversation was left while the browser asked for the microphone.
        if (gone.current) return stream.getTracks().forEach((track) => track.stop());
        const chunks: Blob[] = [];
        const r = new MediaRecorder(stream);
        r.ondataavailable = (e) => chunks.push(e.data);
        r.onstop = () => {
            stream.getTracks().forEach((track) => track.stop());
            recorder.current = null;
            if (gone.current) return;
            setSeconds(null);
            const blob = new Blob(chunks, { type: r.mimeType });
            if (blob.size) setRecording({ blob, url: URL.createObjectURL(blob) });
        };
        recorder.current = r;
        r.start();
        setSeconds(0);
    };
    useEffect(() => {
        if (seconds === null) return;
        if (seconds >= MAX_SECONDS) {
            if (recorder.current?.state === "recording") recorder.current.stop();
            return;
        }
        const timer = setTimeout(() => setSeconds(seconds + 1), 1000);
        return () => clearTimeout(timer);
    }, [seconds]);
    // Leaving the conversation turns the microphone off.
    useEffect(() => {
        gone.current = false;
        return () => {
            gone.current = true;
            if (recorder.current?.state === "recording") recorder.current.stop();
        };
    }, []);
    const discard = () => {
        if (recording) URL.revokeObjectURL(recording.url);
        setRecording(null);
    };

    if (seconds !== null) {
        return (
            <div style={{ display: "flex", flex: "1 0 100%", gap: 8, alignItems: "center" }}>
                <Text type="danger">{t("Recording…")} {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</Text>
                <Button danger shape="circle" size="large" icon={<StopOutlined />} aria-label={t("Stop recording")} title={t("Stop recording")} onClick={() => recorder.current?.state === "recording" && recorder.current.stop()} />
            </div>
        );
    }
    if (recording) {
        return (
            <div style={{ display: "flex", flex: "1 0 100%", gap: 8, alignItems: "center", minWidth: 0 }}>
                <audio controls src={recording.url} aria-label={t("Voice message")} style={{ width: 200, minWidth: 0 }} />
                <Button shape="circle" size="large" icon={<DeleteOutlined />} disabled={busy} aria-label={t("Discard")} title={t("Discard")} onClick={discard} />
                <Button type="primary" shape="circle" size="large" icon={<SendOutlined />} loading={busy} aria-label={t("Send the recording")} title={t("Send the recording")} onClick={async () => { if (await sendAudio(recording.blob)) discard(); }} />
            </div>
        );
    }
    const button = (label: string, icon: ReactNode, onClick: () => void) => (
        <Button type="text" shape="circle" icon={icon} disabled={busy} aria-label={t(label)} title={t(label)} onClick={onClick} />
    );
    return (
        <div style={{ display: "flex", flex: "1 0 100%" }}>
            <input ref={photos} type="file" accept="image/*" multiple hidden onChange={(e) => { const files = [...(e.target.files ?? [])].slice(0, 10); e.target.value = ""; if (files.length) void sendAll(files.map((f) => async () => f)); }} />
            <input ref={audio} type="file" accept="audio/*" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void sendAudio(file); }} />
            {button("Send product photos", <ShoppingOutlined />, () => setPicking(true))}
            {button("Send photos", <PictureOutlined />, () => photos.current?.click())}
            {button("Record a voice message", busy ? <Spin size="small" /> : <AudioOutlined />, () => void record())}
            {button("Send an audio file", <CustomerServiceOutlined />, () => audio.current?.click())}
            {picking && (
                <ProductPicker
                    onClose={() => setPicking(false)}
                    onSend={(urls) => sendAll(urls.map((url) => async () => {
                        const response = await fetch(optimized(url, 1080));
                        if (!response.ok) throw new Error("This photo can't be read.");
                        return response.blob();
                    }))}
                />
            )}
        </div>
    );
}
