/* Promise-based dialogs shared by the editor and its import helpers. */
(function (global) {
  'use strict';

  let host = null;
  let activeRequest = null;
  let nextId = 1;
  const queue = [];

  function cancelledValue(request) {
    return request.kind === 'prompt' ? null : request.kind === 'confirm' ? false : undefined;
  }

  function settle(request, value) {
    if (!request || request.settled) return;
    request.settled = true;
    if (activeRequest && activeRequest.id === request.id) activeRequest = null;
    request.resolve(value);
  }

  function pump() {
    if (!host || activeRequest || host.closing || !queue.length) return;
    activeRequest = queue.shift();
    host.present(activeRequest);
  }

  function enqueue(kind, message, options) {
    options = options && typeof options === 'object' ? options : {};
    const requiredText = options.requiredText == null ? null : String(options.requiredText);
    let returnFocus = global.document && global.document.activeElement;
    if (host && host.$refs.dialog && host.$refs.dialog.contains(returnFocus)) {
      returnFocus = activeRequest && activeRequest.returnFocus;
    }
    return new Promise(function (resolve) {
      queue.push({
        id: nextId++,
        kind: kind,
        message: String(message == null ? '' : message),
        title: String(options.title || (kind === 'alert' ? 'Notice' : kind === 'prompt' && requiredText == null ? 'Enter a value' : 'Confirm action')),
        confirmLabel: String(options.confirmLabel || (kind === 'alert' ? 'OK' : 'Continue')),
        cancelLabel: String(options.cancelLabel || 'Cancel'),
        danger: options.danger == null ? kind === 'confirm' || requiredText != null : !!options.danger,
        defaultValue: String(options.defaultValue == null ? '' : options.defaultValue),
        requiredText: requiredText,
        returnFocus: returnFocus,
        resolve: resolve,
        settled: false
      });
      pump();
    });
  }

  const component = {
    name: 'AppDialog',
    data: function () {
      return { request: null, inputValue: '', closing: false };
    },
    computed: {
      isAlert: function () { return !!this.request && this.request.kind === 'alert'; },
      isPrompt: function () { return !!this.request && this.request.kind === 'prompt'; },
      canAccept: function () {
        return !!this.request && (!this.isPrompt || this.request.requiredText == null || this.inputValue.trim() === this.request.requiredText);
      }
    },
    mounted: function () {
      host = this;
      pump();
    },
    beforeUnmount: function () {
      if (host !== this) return;
      host = null;
      if (this.request) this.finish(cancelledValue(this.request));
      else settle(activeRequest, cancelledValue(activeRequest || { kind: 'alert' }));
      while (queue.length) {
        const request = queue.shift();
        settle(request, cancelledValue(request));
      }
    },
    methods: {
      present: async function (request) {
        this.request = request;
        this.inputValue = request.defaultValue;
        await this.$nextTick();
        if (host !== this || !this.request || this.request.id !== request.id || request.settled) return;
        const dialog = this.$refs.dialog;
        try {
          dialog.showModal();
          const initialFocus = request.kind === 'alert' ? this.$refs.confirmButton : this.$refs.cancelButton;
          if (initialFocus) initialFocus.focus({ preventScroll: true });
        } catch (error) {
          // An unavailable dialog must never turn a destructive request into approval.
          console.error('Unable to open the application dialog.', error);
          this.cancel();
        }
      },
      accept: function () {
        if (!this.request || !this.canAccept) return;
        this.finish(this.isPrompt ? this.inputValue : this.isAlert ? undefined : true);
      },
      cancel: function () {
        if (this.request) this.finish(cancelledValue(this.request));
      },
      finish: function (value) {
        const request = this.request;
        if (!request || request.settled) return;
        this.request = null;
        const dialog = this.$refs.dialog;
        if (dialog && dialog.open) {
          this.closing = true;
          dialog.close();
        }
        settle(request, value);
        const target = request.returnFocus;
        if (target && target.isConnected && !target.disabled && typeof target.focus === 'function') {
          target.focus({ preventScroll: true });
        }
        if (!this.closing) pump();
      },
      dialogClosed: function () {
        if (this.closing) {
          this.closing = false;
          pump();
        } else {
          // Closing the DOM dialog directly is cancellation, never acceptance.
          this.cancel();
        }
      },
      handleKeydown: function (event) {
        if (event.isComposing || event.keyCode === 229) return;
        if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's') {
          event.preventDefault();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          this.cancel();
        } else if (event.key === 'Enter' && event.target === this.$refs.cancelButton) {
          event.preventDefault();
          this.cancel();
        } else if (event.key === 'Enter' && event.target === this.$refs.confirmButton) {
          event.preventDefault();
          this.accept();
        } else if (event.key === 'Enter' && event.target === this.$refs.promptInput) {
          event.preventDefault();
          this.accept();
        } else if (event.key === 'Enter' && event.target === this.$refs.dialog) {
          event.preventDefault();
          this.cancel();
        }
      }
    },
    template: `
      <dialog ref="dialog" class="appDialog" :class="{ appDialogDanger: request && request.danger }"
        :role="isAlert || (request && request.danger) ? 'alertdialog' : 'dialog'"
        aria-modal="true" aria-labelledby="appDialogTitle"
        :aria-describedby="isPrompt && request.requiredText != null ? 'appDialogMessage appDialogPromptHelp' : 'appDialogMessage'"
        @cancel.prevent="cancel" @close="dialogClosed" @keydown.stop="handleKeydown" @keyup.stop @keypress.stop @click.stop>
        <template v-if="request">
          <header class="appDialogHeader"><h2 id="appDialogTitle">{{ request.title }}</h2></header>
          <div id="appDialogMessage" class="appDialogMessage">{{ request.message }}</div>
          <div v-if="isPrompt" class="appDialogPrompt">
            <label for="appDialogInput">{{ request.requiredText == null ? 'Your response' : 'Type ' + request.requiredText + ' to continue' }}</label>
            <input id="appDialogInput" ref="promptInput" v-model="inputValue" type="text" autocomplete="off" spellcheck="false"
              :aria-describedby="request.requiredText == null ? undefined : 'appDialogPromptHelp'">
            <p v-if="request.requiredText != null" id="appDialogPromptHelp">Enter {{ request.requiredText }} exactly. Capitalization matters.</p>
          </div>
          <footer class="appDialogActions">
            <button v-if="!isAlert" ref="cancelButton" type="button" class="appDialogCancel" autofocus @click="cancel">{{ request.cancelLabel }}</button>
            <button ref="confirmButton" type="button" class="appDialogConfirm" :autofocus="isAlert" :disabled="!canAccept" @click="accept">{{ request.confirmLabel }}</button>
          </footer>
        </template>
      </dialog>`
  };

  global.AppDialogs = {
    component: component,
    alert: function (message, options) { return enqueue('alert', message, options); },
    confirm: function (message, options) { return enqueue('confirm', message, options); },
    prompt: function (message, options) { return enqueue('prompt', message, options); },
    get isOpen() { return !!activeRequest || !!queue.length || !!(host && host.closing); }
  };
})(window);
