/* Classic SharedWorker: all tabs on this origin share this one storage owner. */
'use strict';
importScripts('dictionarySync.js', 'cloudSync.js', 'collaborationProtocol.js', 'collaborationSync.js', 'offlineStore.js', 'instanceCoordinator.js');
let coordinator;
let restarting = Promise.resolve();
self.onconnect = event => {
  const port = event.ports[0];
  port.onmessage = first => {
    // Recovery is serialized so an expired/suspended owner cannot race two new owners.
    restarting = restarting.catch(() => {}).then(async () => {
      if (coordinator?.failed || coordinator?.destroyed) { await coordinator.destroy().catch(() => {}); coordinator = null; }
      if (!coordinator) coordinator = new InstanceCoordinator.Coordinator({ store: OfflineStore, CloudSync,
        CollaborationSync, DictionarySync, CollaborationProtocol, fetch: self.fetch.bind(self),
        WebSocket: self.WebSocket, apiBase: first.data?.apiBase, mode: 'shared' });
      const peer = coordinator.attach(port);
      try { await coordinator.receive(peer, first.data); }
      catch (error) {
        port.postMessage({ protocol: InstanceCoordinator.PROTOCOL, type: 'reply', id: first.data?.id, error: InstanceCoordinator.errorData(error) });
        if (coordinator.failed) { await coordinator.destroy().catch(() => {}); coordinator = null; }
      }
    });
  };
  port.start();
};
