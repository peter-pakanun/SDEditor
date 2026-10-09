'use strict';

importScripts('dictionaryScope.js', 'dictionaryMatching.js');

const dictionaryRuntime = DictionaryMatching.createRuntime({
  postMessage: message => self.postMessage(message),
});
self.onmessage = event => dictionaryRuntime.handleMessage(event.data);
self.postMessage({ type: 'started', version: 1 });
