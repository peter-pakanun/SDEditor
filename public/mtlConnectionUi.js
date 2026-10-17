/* Admin-only connection metadata. Sign-in and credential import stay outside the browser. */
(function(root,factory){
    const api=factory();
    if(typeof module==='object'&&module.exports)module.exports=api;
    else root.MtlConnectionUI=api;
})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    const states=Object.freeze(['disabled','not-configured','not-connected','connected','refreshing','needs-reconnection','disconnected','revoking','revocation-failed','unavailable']);
    const actions=Object.freeze(['disconnect','revoke']);
    const base='/v1/admin/mtl/connection';
    const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
    const reauthCodes=new Set(['MTL_ADMIN_REAUTH_REQUIRED','MTL_REAUTH_REQUIRED','REAUTH_REQUIRED']);
    const labels=Object.freeze({disabled:'Not connected','not-configured':'Not connected','not-connected':'Not connected',connected:'Connected',refreshing:'Refreshing connection',
        'needs-reconnection':'Reconnect required',disconnected:'Disconnected',revoking:'Revocation pending','revocation-failed':'Revocation not confirmed',unavailable:'Status unavailable'});
    function sanitizeConnection(input){
        if(!input||typeof input!=='object'||Array.isArray(input)||!states.includes(input.state)
            ||typeof input.enabled!=='boolean'||typeof input.connected!=='boolean'||!Number.isSafeInteger(input.revision)||input.revision<0
            ||input.hostedConnectAvailable!==false||input.bootstrap!=='local-sign-in-import')throw new TypeError('Invalid MTL connection metadata.');
        const value={enabled:input.enabled,state:input.state,revision:input.revision,connected:input.connected,
            hostedConnectAvailable:false,bootstrap:'local-sign-in-import'};
        for(const field of ['requiresReauthorization','remoteRevocationConfirmed','canDisconnect','canRevoke']){
            if(own(input,field)&&typeof input[field]!=='boolean')throw new TypeError('Invalid MTL connection metadata.');
            value[field]=input[field]===true;
        }
        for(const field of ['expiresAt','connectedAt','updatedAt'])if(own(input,field)){
            if(input[field]!==null&&(!Number.isSafeInteger(input[field])||input[field]<0))throw new TypeError('Invalid MTL connection metadata.');
            value[field]=input[field];
        }
        return value;
    }
    function allowed(host){
        return host.cloudSignedIn===true&&host.cloudUser?.isAdmin===true&&host.cloudUser.role==='admin'&&typeof host.cloudUser.id==='string'&&!!host.cloudUser.id
            &&host.cloudProfileId===host.cloudUser.id&&typeof host._cloud?.request==='function'&&!host._cloud.destroyed;
    }
    function accessKey(host){
        return JSON.stringify([host.cloudSignedIn,host.cloudProfileId,host.cloudUser?.id,host.cloudUser?.isAdmin,
            host.cloudUser?.role,host.cloudUser?.assignmentVersion,host._cloud?.epoch,host.privateMediaEpoch]);
    }
    function context(host){return {client:host._cloud,key:accessKey(host)};}
    const sameContext=(host,captured)=>allowed(host)&&captured?.client===host._cloud&&captured.key===accessKey(host);
    function errorText(error,operation){
        const code=error?.code;
        if(reauthCodes.has(code))return 'Sign out of SDEditor, then sign in again with Google as Admin and retry within five minutes. Activity does not renew this confirmation.';
        if(code==='MTL_CONNECTION_CHANGED')return 'The MTL connection changed. Review the current status and retry the action.';
        if(['MTL_REVOCATION_UNCONFIRMED','MTL_REVOCATION_FAILED','MTL_REVOKE_FAILED'].includes(code))return 'Remote revocation was not confirmed. Revoke the SDEditor connection in ChatGPT Settings, or disconnect this server locally.';
        if(code==='MTL_STATUS_REQUIRED')return 'Load the current MTL connection status before changing it.';
        if(error?.name==='AbortError'&&operation!=='load')return 'The MTL connection action timed out. Open MTL settings again to check its status before trying again.';
        if(error instanceof TypeError)return 'The server returned invalid MTL connection metadata.';
        if(operation==='load')return 'Could not load the MTL connection status. Open MTL settings again to retry.';
        return operation==='revoke'?'The MTL connection could not be revoked. Retry the action when ready.'
            :'The MTL connection could not be disconnected. Retry the action when ready.';
    }
    const mixin={
        data(){return {mtlConnectionState:null,mtlConnectionError:'',mtlConnectionErrorCode:'',mtlConnectionBusy:false,mtlConnectionLoaded:false};},
        computed:{
            mtlConnectionAllowed(){return allowed(this);},
            mtlConnectionAccessKey(){return accessKey(this);},
            mtlConnectionLabel(){return labels[this.mtlConnectionState?.state]||'Status not loaded';},
            mtlConnectionGenerationDisabled(){return this.mtlConnectionLoaded&&this.mtlConnectionState?.enabled===false;},
            mtlConnectionRequiresAdminReauth(){return reauthCodes.has(this.mtlConnectionErrorCode);},
            mtlConnectionCanDisconnect(){
                return allowed(this)&&!this.mtlConnectionBusy&&this.mtlConnectionLoaded&&this.mtlConnectionState?.revision>0
                    &&this.mtlConnectionState.canDisconnect===true;
            },
            mtlConnectionCanRevoke(){
                return this.mtlConnectionCanDisconnect&&this.mtlConnectionState.canRevoke===true;
            },
            mtlConnectionGuidance(){
                if(this.mtlConnectionRequiresAdminReauth)return 'A new Admin sign-in must be no more than five minutes old. Continued activity does not extend that window.';
                const state=this.mtlConnectionState?.state;
                if(state==='disabled')return 'MTL generation is disabled in the server configuration.';
                if(state==='revocation-failed')return 'Remote revocation was not confirmed. Revoke the SDEditor connection in ChatGPT Settings, or disconnect this server locally.';
                if(['not-configured','not-connected','needs-reconnection','disconnected'].includes(state))return 'Use the SDEditor local sign-in helper, then import its protected session on the server.';
                if(state==='unavailable')return 'Connection status is unavailable. Open MTL settings again to retry.';
                return '';
            }
        },
        watch:{mtlConnectionAccessKey:{flush:'sync',handler(next,previous){if(next!==previous)this.mtlConnectionReset();}}},
        beforeUnmount(){this.mtlConnectionReset();},
        methods:{
            mtlConnectionReset(){
                this._mtlConnectionRun?.controller.abort();this._mtlConnectionRun=null;this._mtlConnectionOwner=null;
                this._mtlConnectionFailures={};this.mtlConnectionState=null;this.mtlConnectionError='';this.mtlConnectionErrorCode='';
                this.mtlConnectionBusy=false;this.mtlConnectionLoaded=false;
            },
            mtlConnectionCapture(){
                if(!allowed(this)){this.mtlConnectionReset();return null;}
                if(this._mtlConnectionOwner&&!sameContext(this,this._mtlConnectionOwner))this.mtlConnectionReset();
                return context(this);
            },
            mtlConnectionSetFailure(operation,error){
                const failures=this._mtlConnectionFailures ||= {};
                if(error)failures[operation]={message:errorText(error,operation),code:typeof error.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:''};
                else delete failures[operation];
                const values=Object.values(failures);
                this.mtlConnectionError=[...new Set(values.map(value=>value.message))].join(' ');
                this.mtlConnectionErrorCode=values.find(value=>reauthCodes.has(value.code))?.code||values.at(-1)?.code||'';
            },
            mtlConnectionPublish(input,captured){
                if(!sameContext(this,captured))return false;
                this.mtlConnectionState=sanitizeConnection(input);this.mtlConnectionLoaded=true;this._mtlConnectionOwner=captured;return true;
            },
            async mtlConnectionLoad(){
                const captured=this.mtlConnectionCapture();if(!captured||this.mtlConnectionBusy)return false;
                const run=this._mtlConnectionRun={controller:new AbortController()};this._mtlConnectionOwner=captured;this.mtlConnectionBusy=true;
                const current=()=>this._mtlConnectionRun===run&&sameContext(this,captured)&&!run.controller.signal.aborted;
                try{
                    const response=await captured.client.request(base,{method:'GET',signal:run.controller.signal});
                    if(!current())return false;
                    this.mtlConnectionPublish(response?.connection,captured);this.mtlConnectionSetFailure('load',null);return true;
                }catch(error){
                    if(current()&&!error.stale)this.mtlConnectionSetFailure('load',error);
                    return false;
                }finally{
                    if(this._mtlConnectionRun===run){if(!sameContext(this,captured))this.mtlConnectionReset();else{this._mtlConnectionRun=null;this.mtlConnectionBusy=false;}}
                }
            },
            async mtlConnectionAction(action){
                if(!actions.includes(action))throw new TypeError('Unsupported MTL connection action.');
                const captured=this.mtlConnectionCapture();if(!captured||this.mtlConnectionBusy)return false;
                if(!this.mtlConnectionLoaded||!this.mtlConnectionState||this.mtlConnectionState.revision<1){
                    this.mtlConnectionSetFailure(action,Object.assign(new Error(),{code:'MTL_STATUS_REQUIRED'}));return false;
                }
                if(!this.mtlConnectionCanDisconnect||action==='revoke'&&!this.mtlConnectionCanRevoke)return false;
                const expectedRevision=this.mtlConnectionState.revision,run=this._mtlConnectionRun={controller:new AbortController()};
                this._mtlConnectionOwner=captured;this.mtlConnectionBusy=true;
                const current=()=>this._mtlConnectionRun===run&&sameContext(this,captured)&&!run.controller.signal.aborted;
                try{
                    const response=await captured.client.request(base+'/'+action,{method:'POST',body:{expectedRevision},signal:run.controller.signal,timeout:45000});
                    if(!current())return false;
                    this.mtlConnectionPublish(response?.connection,captured);this.mtlConnectionSetFailure(action,null);return true;
                }catch(error){
                    if(current()&&!error.stale){
                        if(error.status===409&&error.code==='MTL_CONNECTION_CHANGED'||error.status===502&&error.code==='MTL_REVOCATION_UNCONFIRMED'){
                            const input=error.details?.connection||error.current?.connection||error.current||error.details?.current?.connection;
                            try{const value=sanitizeConnection(input);if(value.revision>=expectedRevision)this.mtlConnectionPublish(value,captured);}catch(_){/* Preserve the last verified status. */}
                        }
                        this.mtlConnectionSetFailure(action,error);
                    }
                    return false;
                }finally{
                    if(this._mtlConnectionRun===run){if(!sameContext(this,captured))this.mtlConnectionReset();else{this._mtlConnectionRun=null;this.mtlConnectionBusy=false;}}
                }
            }
        }
    };
    return {mixin,states,actions,sanitizeConnection,allowed};
});
