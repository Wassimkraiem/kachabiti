// Voice notes → text with Groq's Whisper (OpenAI-compatible endpoint, GROQ_API_KEY).
// No language is forced: customers mix Tunisian Darija and French in one message.

const URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3';
// Spelling hints for the words customers say most (Whisper uses the prompt as context).
const HINTS =
  'Kachabity, kachabia, burnous, dengri, kadroun, blouza, mlef, wazra, zemnia, taille, couleur, livraison, 9adech, famma, chnowa, nheb, ya5i, behi, merci.';

export const transcriptionConfigured = () => Boolean(process.env.GROQ_API_KEY);

export async function transcribe(
  audio: Buffer,
  mime: string,
): Promise<{ text: string; seconds: number }> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not set');
  const extension = mime.includes('ogg')
    ? 'ogg'
    : mime.includes('mpeg')
      ? 'mp3'
      : mime.includes('wav')
        ? 'wav'
        : mime.includes('webm')
          ? 'webm'
          : 'mp4';
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(audio)], { type: mime }),
    `voice.${extension}`,
  );
  form.append('model', MODEL);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  form.append('prompt', HINTS);
  const response = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(
      `Groq transcription failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
  const json = (await response.json()) as { text?: string; duration?: number };
  return {
    text: (json.text ?? '').trim(),
    seconds: Number(json.duration) || 0,
  };
}
