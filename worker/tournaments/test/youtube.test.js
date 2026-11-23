import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaylist, parseFeed } from '../src/youtube.js';

test('YouTube: vídeos de la página de la lista y del resumen RSS', () => {
  const video = (id, title, len) => ({ lockupViewModel: { contentId: id, contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', metadata: { lockupMetadataViewModel: { title: { content: title } } }, contentImage: { thumbnailViewModel: { overlays: [{ text: len }] } } } });
  const data = { contents: [video('Y6sNBajQZKE', 'Siciliana (4)', '52:05'), { x: [video('abcdefghijk', 'Otro', '1:02:03')] }, video('Y6sNBajQZKE', 'Repetido', '1:00')] };
  const html = '<script>var ytInitialData = ' + JSON.stringify(data).replace(/"text":"/g, '"text":"') + ';</script>';
  assert.deepEqual(parsePlaylist(html), [{ id: 'Y6sNBajQZKE', title: 'Siciliana (4)', length: '52:05' }, { id: 'abcdefghijk', title: 'Otro', length: '1:02:03' }]);
  assert.deepEqual(parsePlaylist('<html>sin datos</html>'), []);
  const xml = '<feed><title>CANAL</title><entry><yt:videoId>Y6sNBajQZKE</yt:videoId><title>Trucos &amp; trampas</title><published>2026-11-22T16:00:09+00:00</published></entry></feed>';
  assert.deepEqual(parseFeed(xml), [{ id: 'Y6sNBajQZKE', title: 'Trucos & trampas', published: '2026-11-22T16:00:09+00:00' }]);
});
