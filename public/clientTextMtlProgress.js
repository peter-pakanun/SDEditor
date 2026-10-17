/* Read-only, request-local MTL display. Provisional text is never an editor value. */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api; else root.ClientTextMtlProgress = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    const labels = Object.freeze({ waiting:'Preparing translation', receiving:'Receiving translation', validating:'Validating translation',
        reconnecting:'Waiting for connection', cancelling:'Stopping translation' });
    const Overlay = {
        props:{state:{type:Object,required:true}},
        computed:{
            text(){return typeof this.state.text==='string'?this.state.text:'';},
            phase(){return labels[this.state.phase]||labels.waiting;},
        },
        beforeUnmount(){
            // The provisional region can be read with the keyboard. Return to
            // its original field before removing the focused region.
            if(this.$el.contains(root.document?.activeElement))this.$el.parentElement?.querySelector('[data-ct-target]')?.focus({preventScroll:true});
        },
        template:`<div class="ctMtlInlineOverlay" :class="{'ctMtlSkeletonWaiting':!text}">
          <span class="srOnly" role="status" aria-live="polite">{{ phase }}. The field is read-only. Use Stop translation to cancel.</span>
          <div v-if="!text" class="ctMtlSkeleton" aria-hidden="true"><i></i><i></i><i></i></div>
          <pre v-else class="ctMtlStreamText" role="textbox" aria-readonly="true" aria-label="Provisional MTL translation, not yet validated" tabindex="0">{{ text }}</pre>
        </div>`,
    };
    return {labels,Overlay};
});
