// Self-check of the support bot's pure logic (no database, no network). After `npm run build`:
//   node test/assistant.check.mjs
import assert from 'node:assert/strict';
import { costOf, audioCost } from '../dist/api/src/assistant/costs.js';
import { mask } from '../dist/api/src/assistant/trace.js';
import { parseWebhook } from '../dist/lib/erp/meta.js';
// knowledge.js loads the API config; its pure helpers need no real database.
process.env.DATABASE_URL ??= 'postgresql://unused@127.0.0.1/unused';
process.env.AUTH_SECRET ??= 'self-check-placeholder-secret-32-characters';
const { chunkText, entryChunks, knowledgeBlock } = await import('../dist/api/src/assistant/knowledge.js');

// Masking: phones (with or without +216 and separators) and e-mails never reach Langfuse.
assert.equal(mask('mon num 55 558 648 merci'), 'mon num [phone] merci');
assert.equal(mask('+216 22123456'), '[phone]');
assert.equal(mask('ecrire a ali@gmail.com'), 'ecrire a [email]');
assert.equal(mask('kachabia 149 DT taille L'), 'kachabia 149 DT taille L');

// Cost: uncached input + output + cache reads/writes at Haiku 5.5 prices.
const cost = costOf('claude-haiku-5-5', {
  input_tokens: 1_000_000,
  output_tokens: 1_000_000,
  cache_read_input_tokens: 1_000_000,
  cache_creation_input_tokens: 0,
});
assert.ok(Math.abs(cost - 0.61) < 1e-9, `haiku cost ${cost}`);
assert.equal(costOf('unknown-model', { input_tokens: 5, output_tokens: 5 }), 0);
assert.ok(Math.abs(audioCost(3600) - 0.111) < 1e-9);

// Webhook: attachments kept, our own echoes skipped, Business Suite echoes kept as fromPage.
process.env.META_APP_ID = '111';
const page = (message, extra = {}) => ({
  object: 'page',
  entry: [{ messaging: [{ sender: { id: 'CUSTOMER' }, recipient: { id: 'PAGE' }, timestamp: 1, message, ...extra }] }],
});
const [photo] = parseWebhook(page({ mid: 'm1', attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }] }));
assert.equal(photo.text, '[image]');
assert.deepEqual(photo.attachments, [{ type: 'image', url: 'https://cdn/x.jpg' }]);
assert.equal(photo.fromPage, false);
assert.equal(parseWebhook(page({ mid: 'm2', is_echo: true, app_id: 111, text: 'bot' })).length, 0);
const [human] = parseWebhook(
  page({ mid: 'm3', is_echo: true, app_id: 263902037430900, text: 'agent' }, { sender: { id: 'PAGE' }, recipient: { id: 'CUSTOMER' } }),
);
assert.equal(human.fromPage, true);
assert.equal(human.senderId, 'CUSTOMER');
delete process.env.META_APP_ID;
assert.equal(parseWebhook(page({ mid: 'm4', is_echo: true, text: 'x' })).length, 0);

const [voice] = parseWebhook({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { contacts: [{ wa_id: '21655', profile: { name: 'Ali' } }], messages: [{ from: '21655', id: 'w1', timestamp: '1', type: 'audio', audio: { id: 'MEDIA' } }] } }] }],
});
assert.deepEqual(voice.attachments, [{ type: 'audio', mediaId: 'MEDIA' }]);
assert.equal(voice.text, '[audio]');

// Knowledge: paragraphs grouped up to ~800 characters, nothing lost; a Q&A stays one chunk.
const paragraph = 'Livraison partout en Tunisie. '.repeat(10).trim();
const doc = Array.from({ length: 6 }, () => paragraph).join('\n\n');
const chunks = chunkText(doc);
assert.ok(chunks.length > 1 && chunks.every((c) => c.length <= 800 * 2), `chunks ${chunks.map((c) => c.length)}`);
assert.equal(chunks.join('\n').replace(/\s+/g, ''), doc.replace(/\s+/g, ''));
assert.equal(chunkText('x'.repeat(5000)).length, 7); // one very long sentence is still cut
assert.deepEqual(entryChunks({ kind: 'faq', title: ' Ki twasslou? ', content: '24-72h ' }), ['Q: Ki twasslou?\nA: 24-72h']);
assert.ok(entryChunks({ kind: 'doc', title: 'Retours', content: doc }).every((c) => c.startsWith('Retours\n')));
// The block given to the bot: marked as the team's, numbered, capped in size; nothing when no match.
const hit = (content) => ({ chunk_id: 'c', entry_id: 'e', kind: 'faq', title: 't', content, score: 1, found_by: ['words'] });
assert.equal(knowledgeBlock([]), null);
const block = knowledgeBlock([hit('A'), hit('y'.repeat(9000)), hit('never shown')]);
assert.ok(block.startsWith('[Kachabity knowledge') && block.includes('1. A') && !block.includes('never shown'));
assert.ok(block.length < 4400, `block ${block.length}`);

console.log('assistant self-check: ok');
