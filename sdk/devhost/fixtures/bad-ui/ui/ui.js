/* global URLSearchParams, location, parent, console, setTimeout */
// A custom UI that goes wrong on purpose, for `est dev --json`'s `ui` lines (e2e/est-devhost.spec.ts):
// a missing stylesheet (index.html), a good est:ready, two messages the host refuses, a console
// error and an uncaught error.
const nonce = new URLSearchParams(location.hash.slice(1)).get('n');
parent.postMessage({ v: 1, type: 'est:ready', nonce }, '*');
parent.postMessage({ v: 1, type: 'est:param', nonce, id: 0, value: 5 }, '*');
parent.postMessage({ v: 1, type: 'est:param', nonce: 'not-the-nonce', id: 0, value: 0.5 }, '*');
console.error('boom from the UI');
setTimeout(() => { throw new Error('kaboom from the UI'); }, 10);
