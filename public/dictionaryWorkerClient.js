(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DictionaryWorkerClient = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  function aborted(message = 'Dictionary request belongs to a previous context.') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  }

  const TRANSPORT_BYTES = 64 * 1024;
  const textBytes = value => String(value ?? '').length * 2;
  const alternateBytes = alt => 64 + textBytes(alt?._id) + textBytes(alt?.find) + textBytes(alt?.replace);

  function* transferPackets(snapshot) {
    const base = { scopeEpoch: snapshot.scopeEpoch, generation: snapshot.generation };
    yield { type: 'beginSnapshot', ...base, game: snapshot.game };
    let rows = [], rowBytes = 0, startIndex = 0;
    function* fragments(entryIndex, altIndex, field, value) {
      const source = String(value ?? '');
      for (let position = 0; position < source.length; position += TRANSPORT_BYTES / 2) {
        yield { type: 'appendText', ...base, entryIndex,
          ...(altIndex == null ? {} : { altIndex }), field,
          text: source.slice(position, position + TRANSPORT_BYTES / 2) };
      }
    }
    for (let index = 0; index < snapshot.entries.length; index++) {
      const entry = snapshot.entries[index];
      let bytes = 128 + textBytes(entry?._id) + textBytes(entry?.find)
        + textBytes(entry?.replace) + textBytes(entry?.tlnote);
      const alts = Array.isArray(entry?.alts) ? entry.alts : [];
      for (let i = 0; i < alts.length; i++) {
        bytes += alternateBytes(alts[i]);
        if (!(i % 32)) yield null;
      }
      if (bytes > TRANSPORT_BYTES || alts.length > 256) {
        if (rows.length) {
          yield { type: 'appendEntries', ...base, startIndex, entries: rows };
          rows = []; rowBytes = 0;
        }
        const placeholder = { _id: entry._id, find: '', replace: '', tlnote: '', alts: [] };
        if (Object.hasOwn(entry, 'gameScope')) placeholder.gameScope = entry.gameScope;
        yield { type: 'appendEntries', ...base, startIndex: index, entries: [placeholder] };
        for (const field of ['find', 'replace', 'tlnote']) yield* fragments(index, null, field, entry[field]);
        let alternatives = [], alternativeSize = 0, alternativeStart = 0;
        for (let altIndex = 0; altIndex < alts.length; altIndex++) {
          const alt = alts[altIndex];
          const size = alternateBytes(alt);
          if (alternatives.length && (alternatives.length >= 128 || alternativeSize + size > TRANSPORT_BYTES)) {
            yield { type: 'appendAlternates', ...base, entryIndex: index,
              startIndex: alternativeStart, alts: alternatives };
            alternatives = []; alternativeSize = 0;
          }
          if (size > TRANSPORT_BYTES) {
            yield { type: 'appendAlternates', ...base, entryIndex: index,
              startIndex: altIndex, alts: [{ _id: alt._id, find: '', replace: '' }] };
            yield* fragments(index, altIndex, 'find', alt.find);
            yield* fragments(index, altIndex, 'replace', alt.replace);
          } else {
            if (!alternatives.length) alternativeStart = altIndex;
            alternatives.push(alt);
            alternativeSize += size;
          }
          yield null;
        }
        if (alternatives.length) yield { type: 'appendAlternates', ...base,
          entryIndex: index, startIndex: alternativeStart, alts: alternatives };
        startIndex = index + 1;
        continue;
      }
      if (rows.length && (rows.length >= 128 || rowBytes + bytes > TRANSPORT_BYTES)) {
        yield { type: 'appendEntries', ...base, startIndex, entries: rows };
        rows = []; rowBytes = 0;
      }
      if (!rows.length) startIndex = index;
      rows.push(entry);
      rowBytes += bytes;
      yield null;
    }
    if (rows.length) yield { type: 'appendEntries', ...base, startIndex, entries: rows };
    yield { type: 'commitSnapshot', ...base };
  }

  function create(options = {}) {
    const WorkerClass = Object.hasOwn(options, 'Worker') ? options.Worker : root.Worker;
    const setTimer = options.setTimeout || root.setTimeout.bind(root);
    const clearTimer = options.clearTimeout || root.clearTimeout.bind(root);
    const now = options.now || (() => root.performance?.now?.() ?? Date.now());
    let worker = null, runtime = null, handshake = null;
    let mode = 'starting', disposed = false, scopeEpoch = 0, scopeKey = '';
    let readySnapshot = null, buildingSnapshot = null, queuedSnapshot = null;
    let bootstrap = false, nextRequestId = 0, lastError = null, compiledReadyGeneration = 0;
    let transport = null, transportTimer = null, serializationMs = 0, transferMs = 0;
    const requests = new Map(), readyWaiters = new Set();

    function settleWaiters(error) {
      for (const waiter of readyWaiters) {
        if (error || readySnapshot && readySnapshot.generation >= waiter.generation && !bootstrap) {
          readyWaiters.delete(waiter);
          if (error) waiter.reject(error);
          else waiter.resolve({ scopeEpoch, generation: readySnapshot.generation });
        }
      }
    }

    function finalFailure(error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      clearTimer(transportTimer);
      transport = null;
      buildingSnapshot = null;
      queuedSnapshot = null;
      bootstrap = false;
      settleWaiters(lastError);
      if (!compiledReadyGeneration) {
        for (const request of requests.values()) request.reject(lastError);
        requests.clear();
      } else for (const request of requests.values()) sendRequest(request);
      options.onError?.(lastError);
    }

    function discardFallbackRuntime() {
      try { runtime?.dispose(); } catch (_) { /* A failed runtime is already unusable. */ }
      runtime = null;
      compiledReadyGeneration = 0;
    }

    function initializeFallbackRuntime() {
      const api = options.engine || root.DictionaryMatching;
      if (!api?.createRuntime) throw new Error('Dictionary preparation is unavailable in this browser.');
      runtime = api.createRuntime({ postMessage: receive,
        schedule: options.schedule || (callback => setTimer(callback, 0)),
        now: options.now, sliceMs: 4 });
      runtime.handleMessage({ type: 'setScope', scopeEpoch, scopeKey });
    }

    function send(message) {
      if (disposed) return;
      try {
        if (mode === 'worker') {
          const started = now();
          worker.postMessage(message);
          if (transport) transport.serializationMs += now() - started;
        }
        else if (mode === 'fallback') {
          // Scope fencing remains valid even when runtime initialization failed;
          // the next submitted snapshot recreates it with this current scope.
          if (!runtime && message.type === 'setScope') return;
          runtime.handleMessage(message);
        }
      } catch (error) {
        if (mode === 'fallback') { discardFallbackRuntime(); finalFailure(error); }
        else switchToFallback(error);
      }
    }

    function startQueued() {
      if (disposed || mode === 'starting' || buildingSnapshot || !queuedSnapshot) return;
      if (mode === 'fallback' && !runtime) {
        try { initializeFallbackRuntime(); }
        catch (error) { discardFallbackRuntime(); finalFailure(error); return; }
      }
      buildingSnapshot = queuedSnapshot;
      queuedSnapshot = null;
      if (mode === 'fallback') send({ type: 'setSnapshot', ...buildingSnapshot });
      else {
        transport = { iterator: transferPackets(buildingSnapshot), scopeEpoch,
          generation: buildingSnapshot.generation, started: now(), serializationMs: 0 };
        pumpTransport();
      }
    }

    function pumpTransport() {
      transportTimer = null;
      const active = transport;
      if (!active || disposed || mode !== 'worker' || active.scopeEpoch !== scopeEpoch) return;
      const started = now();
      let messages = 0;
      do {
        const next = active.iterator.next();
        if (next.done) {
          if (transport === active) {
            serializationMs = active.serializationMs;
            transferMs = now() - active.started;
            transport = null;
          }
          return;
        }
        if (next.value) {
          messages++;
          send(next.value);
          if (next.value.type === 'commitSnapshot') {
            serializationMs = active.serializationMs;
            transferMs = now() - active.started;
            if (transport === active) transport = null;
            return;
          }
        }
        if (transport !== active || mode !== 'worker') return;
      } while (messages < 4 && now() - started < 4);
      transportTimer = setTimer(pumpTransport, 0);
    }

    function sendRequest(request) {
      if (request.sent || !readySnapshot || !compiledReadyGeneration || bootstrap || mode === 'starting') return;
      request.sent = true;
      send({ type: 'match', requestId: request.id, scopeEpoch,
        units: request.units, options: request.options });
    }

    function receive(message) {
      if (disposed || !message) return;
      if (message.type === 'started') {
        if (mode !== 'starting') return;
        if (message.version !== 1) { switchToFallback(new Error('Unsupported Dictionary worker version.')); return; }
        clearTimer(handshake);
        handshake = null;
        mode = 'worker';
        send({ type: 'setScope', scopeEpoch, scopeKey });
        startQueued();
        return;
      }
      if (message.scopeEpoch !== scopeEpoch) return;
      if (message.type === 'ready') {
        if (!buildingSnapshot || message.generation !== buildingSnapshot.generation) return;
        const published = buildingSnapshot;
        buildingSnapshot = null;
        const changed = !readySnapshot || published.generation > readySnapshot.generation;
        if (changed) readySnapshot = published;
        compiledReadyGeneration = published.generation;
        bootstrap = false;
        lastError = null;
        settleWaiters();
        if (changed) options.onReady?.({ scopeEpoch, generation: published.generation });
        for (const request of requests.values()) sendRequest(request);
        startQueued();
      } else if (message.type === 'matches') {
        const request = requests.get(message.requestId);
        if (!request) return;
        requests.delete(message.requestId);
        request.resolve(message);
      } else if (message.type === 'error') {
        const error = new Error(message.error?.message || 'Could not prepare Dictionary matches.');
        if (message.requestId != null) {
          const request = requests.get(message.requestId);
          if (!request) return;
          if (mode !== 'fallback') {
            // Keep the request pending while the cooperative fallback restores
            // the published snapshot and retries the same query.
            switchToFallback(error);
          } else {
            requests.delete(message.requestId);
            request.reject(error);
            options.onError?.(error);
          }
        } else if (mode === 'fallback') finalFailure(error);
        else switchToFallback(error);
      }
    }

    function switchToFallback() {
      if (disposed || mode === 'fallback') return;
      clearTimer(handshake);
      handshake = null;
      clearTimer(transportTimer);
      transportTimer = null;
      transport = null;
      if (worker) {
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        worker.terminate?.();
        worker = null;
      }
      mode = 'fallback';
      compiledReadyGeneration = 0;
      for (const request of requests.values()) request.sent = false;
      const latest = queuedSnapshot || buildingSnapshot;
      buildingSnapshot = null;
      queuedSnapshot = latest;
      try {
        initializeFallbackRuntime();
        if (readySnapshot) {
          // Restore the published version first, so in-flight queries retain
          // their previous dictionary before the newest replacement is built.
          bootstrap = true;
          buildingSnapshot = readySnapshot;
          runtime.handleMessage({ type: 'setSnapshot', ...readySnapshot });
        } else startQueued();
      } catch (error) { discardFallbackRuntime(); finalFailure(error); }
    }

    const client = {
      get scopeEpoch() { return scopeEpoch; },
      get scopeKey() { return scopeKey; },
      get readyGeneration() { return readySnapshot?.generation || 0; },
      get compiledReadyGeneration() { return compiledReadyGeneration; },
      get readySnapshot() { return readySnapshot; },
      get buildingGeneration() { return buildingSnapshot?.generation || 0; },
      get fallback() { return mode === 'fallback'; },
      get serializationMs() { return serializationMs; },
      get transferMs() { return transferMs; },
      setScope(key) {
        const nextKey = String(key ?? '');
        if (scopeEpoch && nextKey === scopeKey) return scopeEpoch;
        scopeEpoch++;
        scopeKey = nextKey;
        clearTimer(transportTimer);
        transportTimer = null;
        transport = null;
        readySnapshot = buildingSnapshot = queuedSnapshot = null;
        compiledReadyGeneration = 0;
        bootstrap = false;
        if (mode !== 'fallback' || runtime) lastError = null;
        const error = aborted();
        settleWaiters(error);
        for (const request of requests.values()) request.reject(error);
        requests.clear();
        send({ type: 'setScope', scopeEpoch, scopeKey });
        return scopeEpoch;
      },
      submitSnapshot(snapshot) {
        if (disposed) throw aborted('Dictionary worker has been disposed.');
        const generation = Number(snapshot.generation);
        if (!Number.isFinite(generation) || generation <= 0) throw new Error('Dictionary snapshot requires a positive generation.');
        if (generation <= Math.max(readySnapshot?.generation || 0, buildingSnapshot?.generation || 0, queuedSnapshot?.generation || 0)) return generation;
        // The caller supplies detached, immutable plain rows. Keeping only the
        // submitted build and newest pending input avoids retaining every edit.
        queuedSnapshot = { scopeEpoch, generation, game: snapshot.game, entries: snapshot.entries || [] };
        lastError = null;
        startQueued();
        return generation;
      },
      waitReady({ generation = 0 } = {}) {
        if (disposed) return Promise.reject(aborted('Dictionary worker has been disposed.'));
        if (readySnapshot && compiledReadyGeneration && !bootstrap && readySnapshot.generation >= generation) return Promise.resolve({ scopeEpoch, generation: readySnapshot.generation });
        if (lastError) return Promise.reject(lastError);
        return new Promise((resolve, reject) => readyWaiters.add({ generation, resolve, reject }));
      },
      match(units, matchOptions = {}) {
        const id = ++nextRequestId;
        let request;
        const promise = new Promise((resolve, reject) => {
          request = { id, units, options: matchOptions, resolve, reject, sent: false };
          if (disposed) { reject(aborted('Dictionary worker has been disposed.')); return; }
          if (lastError && !compiledReadyGeneration) { reject(lastError); return; }
          requests.set(id, request);
          sendRequest(request);
        });
        promise.cancel = () => {
          if (!requests.has(id)) return;
          requests.delete(id);
          if (request.sent) send({ type: 'cancel', requestId: id, scopeEpoch });
          request.reject(aborted('Dictionary query was cancelled.'));
        };
        return promise;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        clearTimer(handshake);
        clearTimer(transportTimer);
        transport = null;
        worker?.terminate?.();
        runtime?.dispose();
        const error = aborted('Dictionary worker has been disposed.');
        settleWaiters(error);
        for (const request of requests.values()) request.reject(error);
        requests.clear();
        readySnapshot = buildingSnapshot = queuedSnapshot = null;
        compiledReadyGeneration = 0;
      },
    };

    try {
      if (typeof WorkerClass !== 'function') throw new Error('Web Workers are unavailable.');
      worker = new WorkerClass(options.url || 'dictionaryWorker.js');
      worker.onmessage = event => receive(event.data);
      worker.onerror = event => { event.preventDefault?.(); switchToFallback(); };
      worker.onmessageerror = () => switchToFallback();
      handshake = setTimer(() => switchToFallback(), options.handshakeMs ?? 5000);
    } catch (_) { switchToFallback(); }
    return client;
  }

  return { create, aborted };
});
