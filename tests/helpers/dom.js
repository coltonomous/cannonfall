import indexHtml from '../../index.html?raw';

const body = indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];

/** Replace the jsdom document body with the real game markup from index.html. */
export function loadIndexHtml() {
  document.body.innerHTML = body;
}
