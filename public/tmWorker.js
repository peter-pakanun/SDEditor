'use strict';
importScripts('regexEngine.js', 'translationDiagnostics.js', 'translationMemory.js');
const tmRuntime = TranslationMemory.createRuntime({ postMessage: message => self.postMessage(message) });
self.onmessage = event => tmRuntime.handleMessage(event.data);
self.postMessage({ type: 'started', version: 1 });
