(function (root, factory) {
  const engine = typeof module === 'object' && module.exports ? require('./translationMemory.js') : root.TranslationMemory;
  const api = factory(root, engine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TranslationMemoryWorkerClient = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, defaultEngine) {
  'use strict';

  const aborted = () => Object.assign(new Error('Translation Memory request belongs to a previous context.'), { name: 'AbortError' });
  const PACKET_BYTES = 64 * 1024;
  function* transferPackets(snapshot) {
    const base = { scopeEpoch: snapshot.scopeEpoch, generation: snapshot.generation };
    yield { type: 'beginSnapshot', ...base, game: snapshot.game };
    let units = [], bytes = 0, position = 0;
    for (const unit of snapshot.units) {
      const size = 256 + (String(unit.source || '').length + String(unit.target || '').length + String(unit.note || '').length
        + JSON.stringify(unit.context || {}).length + JSON.stringify(unit.provenance || {}).length) * 2;
      if (units.length && (units.length >= 128 || bytes + size > PACKET_BYTES)) {
        yield { type: 'appendUnits', ...base, units }; units = []; bytes = 0;
      }
      if (size > PACKET_BYTES) {
        yield { type: 'appendUnits', ...base, units: [{ ...unit, source: '', target: '', note: '' }] };
        for (const field of ['source', 'target', 'note']) {
          const value = String(unit[field] || '');
          for (let start = 0; start < value.length; start += PACKET_BYTES / 2) {
            yield { type: 'appendText', ...base, unitIndex: position, field, text: value.slice(start, start + PACKET_BYTES / 2) };
          }
        }
      } else { units.push(unit); bytes += size; }
      position++; yield null;
    }
    if (units.length) yield { type: 'appendUnits', ...base, units };
    yield { type: 'commitSnapshot', ...base };
  }

  function create(options = {}) {
    const WorkerClass = Object.hasOwn(options, 'Worker') ? options.Worker : root.Worker;
    const setTimer = options.setTimeout || root.setTimeout.bind(root), clearTimer = options.clearTimeout || root.clearTimeout.bind(root);
    const now = options.now || (() => root.performance?.now?.() ?? Date.now());
    let worker = null, runtime = null, mode = 'starting', disposed = false, epoch = 0, scopeKey = '';
    let ready = null, building = null, queued = null, compiledGeneration = 0, nextId = 0;
    let handshake = null, transport = null, transportTimer = null, bootstrap = false, lastError = null;
    const requests = new Map(), waiters = new Set();

    function settle(error) {
      for (const waiter of waiters) {
        if (error || ready && compiledGeneration && !bootstrap && ready.generation >= waiter.generation) {
          waiters.delete(waiter);
          if (error) waiter.reject(error); else waiter.resolve({ scopeEpoch: epoch, generation: ready.generation });
        }
      }
    }
    function fail(error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      settle(lastError);
      if (!compiledGeneration) {
        for (const request of requests.values()) request.reject(lastError);
        requests.clear();
      }
      options.onError?.(lastError);
    }
    function initializeRuntime() {
      const engine = options.engine || defaultEngine;
      if (!engine?.createRuntime) throw new Error('Translation Memory preparation is unavailable.');
      runtime = engine.createRuntime({ postMessage: receive, schedule: options.schedule || (callback => setTimer(callback, 0)),
        now: options.now, sliceMs: 4 });
      runtime.handleMessage({ type: 'setScope', scopeEpoch: epoch, scopeKey });
    }
    function send(message) {
      if (disposed) return;
      try {
        if (mode === 'worker') worker.postMessage(message);
        else if (mode === 'fallback') runtime?.handleMessage(message);
      } catch (error) {
        if (mode === 'worker') fallback(); else fail(error);
      }
    }
    function sendRequest(request) {
      if (request.sent || !compiledGeneration || bootstrap || disposed) return;
      request.sent = true;
      send({ type: 'query', scopeEpoch: epoch, requestId: request.id, query: request.query, options: request.options });
    }
    function pump() {
      transportTimer = null;
      const active = transport;
      if (!active || disposed || mode !== 'worker' || active.scopeEpoch !== epoch) return;
      const started = now(); let messages = 0, count = 0;
      do {
        const next = active.iterator.next();
        if (next.done) { transport = null; return; }
        if (next.value) { messages++; send(next.value); }
        if (active !== transport || mode !== 'worker') return;
        if (next.value?.type === 'commitSnapshot') { transport = null; return; }
      } while (++count < 2048 && messages < 4 && now() - started < 4);
      transportTimer = setTimer(pump, 0);
    }
    function startQueued() {
      if (disposed || mode === 'starting' || building || !queued) return;
      if (mode === 'fallback' && !runtime) {
        try { initializeRuntime(); } catch (error) { fail(error); return; }
      }
      building = queued; queued = null;
      if (mode === 'fallback') send({ type: 'setSnapshot', ...building });
      else { transport = { scopeEpoch: epoch, iterator: transferPackets(building) }; pump(); }
    }
    function receive(message) {
      if (disposed || !message) return;
      if (message.type === 'started') {
        if (mode !== 'starting') return;
        if (message.version !== 1) { fallback(); return; }
        clearTimer(handshake); handshake = null; mode = 'worker';
        send({ type: 'setScope', scopeEpoch: epoch, scopeKey }); startQueued(); return;
      }
      if (message.scopeEpoch !== epoch) return;
      if (message.type === 'ready') {
        if (!building || message.generation !== building.generation) return;
        const restored = bootstrap;
        compiledGeneration = message.generation; ready = building; building = null; bootstrap = false; lastError = null;
        settle();
        if (!restored) options.onReady?.(message);
        for (const request of requests.values()) sendRequest(request);
        startQueued(); return;
      }
      if (message.type === 'matches') {
        const request = requests.get(message.requestId);
        if (!request) return;
        requests.delete(message.requestId); request.resolve(message); return;
      }
      if (message.type === 'error') {
        const error = Object.assign(new Error(message.error?.message || 'Translation Memory preparation failed.'), { name: message.error?.name || 'Error' });
        if (message.requestId != null) {
          const request = requests.get(message.requestId); requests.delete(message.requestId); request?.reject(error); return;
        }
        if (building && message.generation === building.generation) {
          building = null; bootstrap = false; fail(error); startQueued();
        }
      }
    }
    function fallback() {
      if (disposed || mode === 'fallback') return;
      clearTimer(handshake); clearTimer(transportTimer); handshake = transportTimer = null; transport = null;
      if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate?.(); worker = null; }
      mode = 'fallback'; compiledGeneration = 0;
      for (const request of requests.values()) request.sent = false;
      const latest = queued || building; building = null; queued = latest;
      try {
        initializeRuntime();
        if (ready) { bootstrap = true; building = ready; send({ type: 'setSnapshot', ...ready }); }
        else startQueued();
      } catch (error) { runtime?.dispose?.(); runtime = null; fail(error); }
    }

    const client = {
      get scopeEpoch() { return epoch; }, get scopeKey() { return scopeKey; },
      get readyGeneration() { return ready?.generation || 0; }, get readySnapshot() { return ready; },
      get compiledReadyGeneration() { return compiledGeneration; }, get buildingGeneration() { return building?.generation || 0; },
      get fallback() { return mode === 'fallback'; },
      setScope(key) {
        if (epoch && String(key) === scopeKey) return epoch;
        epoch++; scopeKey = String(key ?? '');
        clearTimer(transportTimer); transportTimer = null; transport = null;
        ready = building = queued = null; compiledGeneration = 0; bootstrap = false; lastError = null;
        const error = aborted(); settle(error);
        for (const request of requests.values()) request.reject(error);
        requests.clear(); send({ type: 'setScope', scopeEpoch: epoch, scopeKey }); return epoch;
      },
      submitSnapshot(snapshot) {
        if (disposed) throw aborted();
        const generation = Number(snapshot.generation);
        if (!Number.isSafeInteger(generation) || generation < 1) throw new TypeError('Translation Memory requires a positive generation.');
        if (generation <= Math.max(ready?.generation || 0, building?.generation || 0, queued?.generation || 0)) return generation;
        queued = { scopeEpoch: epoch, generation, game: snapshot.game || 'poe1', units: snapshot.units || [] };
        lastError = null; startQueued(); return generation;
      },
      waitReady({ generation = 0 } = {}) {
        if (disposed) return Promise.reject(aborted());
        if (ready && compiledGeneration && !bootstrap && ready.generation >= generation) return Promise.resolve({ scopeEpoch: epoch, generation: ready.generation });
        if (lastError) return Promise.reject(lastError);
        return new Promise((resolve, reject) => waiters.add({ generation, resolve, reject }));
      },
      query(query, queryOptions = {}) {
        const id = ++nextId; let request;
        const promise = new Promise((resolve, reject) => {
          request = { id, query, options: queryOptions, resolve, reject, sent: false };
          if (disposed) { reject(aborted()); return; }
          if (lastError && !compiledGeneration) { reject(lastError); return; }
          requests.set(id, request); sendRequest(request);
        });
        promise.cancel = () => {
          if (!requests.has(id)) return;
          requests.delete(id);
          if (request.sent) send({ type: 'cancel', scopeEpoch: epoch, requestId: id });
          request.reject(aborted());
        };
        return promise;
      },
      dispose() {
        if (disposed) return;
        disposed = true; clearTimer(handshake); clearTimer(transportTimer); transport = null;
        worker?.terminate?.(); runtime?.dispose?.();
        const error = aborted(); settle(error); for (const request of requests.values()) request.reject(error);
        requests.clear(); ready = building = queued = null; compiledGeneration = 0;
      },
    };
    try {
      if (typeof WorkerClass !== 'function') throw new Error('Web Workers are unavailable.');
      worker = new WorkerClass(options.url || 'tmWorker.js');
      worker.onmessage = event => receive(event.data);
      worker.onerror = event => { event.preventDefault?.(); fallback(); };
      worker.onmessageerror = () => fallback();
      handshake = setTimer(fallback, options.handshakeMs ?? 5000);
    } catch (_) { fallback(); }
    return client;
  }
  return { create, aborted, transferPackets };
});
