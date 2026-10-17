/* Admin MTL limits and live quota counters; all edits require explicit Save. */
(function(root,factory){
    const api=factory(root);
    if(typeof module==='object'&&module.exports)module.exports=api;else root.MtlLimitsUI=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
    'use strict';
    const base='/v1/admin/mtl/limits',copy=value=>JSON.parse(JSON.stringify(value));
    const rows=Object.freeze([
        {key:'userMinute',scope:'Your Admin account',window:'Rolling minute',unit:'requests / 60 seconds',group:'user',bucket:'minute'},
        {key:'userDay',scope:'Your Admin account',window:'Day',unit:'requests / day',group:'user',bucket:'day'},
        {key:'userWeek',scope:'Your Admin account',window:'Week',unit:'requests / week',group:'user',bucket:'week'},
        {key:'userConcurrency',scope:'Your Admin account',window:'Active',unit:'concurrent requests',group:'user',bucket:'concurrency'},
        {key:'subscriptionDay',scope:'All accounts · MTL connection',window:'Day',unit:'requests / day',group:'shared',bucket:'day'},
        {key:'subscriptionWeek',scope:'All accounts · MTL connection',window:'Week',unit:'requests / week',group:'shared',bucket:'week'},
        {key:'concurrency',scope:'All accounts · server',window:'Active',unit:'concurrent requests',group:'service',bucket:'concurrency'},
    ]);
    const integer=value=>Number.isSafeInteger(value)&&value>=0;
    const timestamp=value=>value===null||integer(value)&&value<=8640000000000000;
    function sanitize(input,userId){
        if(!input||!integer(input.revision)||input.usage?.user?.id!==userId||input.usage?.timezone!=='Asia/Bangkok'
            ||input.usage.weekStartsOn!=='Monday'||!integer(input.usage.sampledAt))throw new TypeError('Invalid MTL quota metadata.');
        const result={revision:input.revision,limits:{},bounds:{},usage:{sampledAt:input.usage.sampledAt,timezone:input.usage.timezone,
            weekStartsOn:input.usage.weekStartsOn,user:{id:userId},shared:{},service:{}}};
        for(const row of rows){
            const bounds=input.bounds?.[row.key],limit=input.limits?.[row.key],bucket=input.usage[row.group]?.[row.bucket];
            if(!bounds||!integer(bounds.min)||bounds.min<1||!integer(bounds.max)||bounds.max<bounds.min||bounds.max>1000000
                ||!integer(limit)||limit<bounds.min||limit>bounds.max||!bucket||!integer(bucket.used)||bucket.limit!==limit)
                throw new TypeError('Invalid MTL quota metadata.');
            result.limits[row.key]=limit;result.bounds[row.key]={min:bounds.min,max:bounds.max};
            const value={used:bucket.used,limit};
            if(row.bucket!=='concurrency'){
                if(bucket.resetKind!==(row.bucket==='minute'?'rolling':'calendar')||!timestamp(bucket.resetsAt)
                    ||row.bucket!=='minute'&&bucket.resetsAt===null)throw new TypeError('Invalid MTL quota reset metadata.');
                value.resetsAt=bucket.resetsAt;value.resetKind=bucket.resetKind;
                if(row.bucket==='minute'){
                    if(!timestamp(bucket.fullyResetsAt)||bucket.used===0&&(bucket.resetsAt!==null||bucket.fullyResetsAt!==null)
                        ||bucket.used>0&&(bucket.resetsAt===null||bucket.fullyResetsAt===null||bucket.fullyResetsAt<bucket.resetsAt))throw new TypeError('Invalid MTL quota reset metadata.');
                    value.fullyResetsAt=bucket.fullyResetsAt;
                }
            }
            result.usage[row.group][row.bucket]=value;
        }
        return result;
    }
    function allowed(host){return host.cloudSignedIn===true&&host.cloudUser?.isAdmin===true&&host.cloudUser.role==='admin'
        &&typeof host.cloudUser.id==='string'&&!!host.cloudUser.id&&host.cloudProfileId===host.cloudUser.id
        &&typeof host._cloud?.request==='function'&&!host._cloud.destroyed;}
    const access=host=>JSON.stringify([host.cloudSignedIn,host.cloudProfileId,host.cloudUser?.id,host.cloudUser?.isAdmin,
        host.cloudUser?.role,host.cloudUser?.assignmentVersion,host._cloud?.epoch,host.privateMediaEpoch]);
    const current=(host,owner)=>allowed(host)&&owner?.client===host._cloud&&owner.key===access(host);
    const equal=(a,b)=>rows.every(row=>a?.[row.key]===b?.[row.key]);
    const mixin={
        data(){return{mtlLimitsState:null,mtlLimitsDraft:{},mtlLimitsDraftRevision:null,mtlLimitsExpanded:false,mtlLimitsLoading:false,mtlLimitsSaving:false,
            mtlLimitsUnsupported:false,mtlLimitsLoadError:'',mtlLimitsSaveError:'',mtlLimitsPending:false};},
        computed:{
            mtlLimitsAllowed(){return allowed(this);},
            mtlLimitsAccessKey(){return access(this);},
            mtlLimitsOpen(){return allowed(this)&&this.mtlLimitsExpanded&&!!this.settingsDialogVisible&&this.settingsTab==='mtl';},
            mtlLimitsRows(){return rows;},
            mtlLimitsDirty(){return !!this.mtlLimitsState&&!equal(this.mtlLimitsDraft,this.mtlLimitsState.limits);},
            mtlLimitsValidation(){
                if(!this.mtlLimitsState)return '';
                for(const row of rows){const value=this.mtlLimitsDraft[row.key],bounds=this.mtlLimitsState.bounds[row.key];
                    if(!Number.isSafeInteger(value)||value<bounds.min||value>bounds.max)return 'Enter a whole number from '+bounds.min+' to '+bounds.max+' for '+row.scope+' · '+row.window+'.';}
                return '';
            },
            mtlLimitsCanSave(){return current(this,this._mtlLimitsOwner)&&!!this.mtlLimitsState&&!this.mtlLimitsUnsupported&&!this.mtlLimitsSaving
                &&(this.mtlLimitsPending||this.mtlLimitsDirty&&!this.mtlLimitsValidation);},
        },
        watch:{
            mtlLimitsAccessKey:{flush:'sync',handler(){this.mtlLimitsReset();this.$nextTick?.(()=>{if(this.mtlLimitsOpen)this.mtlLimitsStart();});}},
            mtlLimitsOpen(value){if(value)this.mtlLimitsStart();else this.mtlLimitsStop();},
        },
        mounted(){
            this._mtlLimitsResume=()=>{if(this.mtlLimitsOpen&&!root.document?.hidden)this.mtlLimitsLoad();};
            root.document?.addEventListener('visibilitychange',this._mtlLimitsResume);root.addEventListener?.('online',this._mtlLimitsResume);
            if(this.mtlLimitsOpen)this.mtlLimitsStart();
        },
        beforeUnmount(){this.mtlLimitsReset();root.document?.removeEventListener('visibilitychange',this._mtlLimitsResume);root.removeEventListener?.('online',this._mtlLimitsResume);},
        methods:{
            mtlLimitsToggle(event){this.mtlLimitsExpanded=event.currentTarget.open;},
            mtlLimitsStop(){clearTimeout(this._mtlLimitsTimer);this._mtlLimitsTimer=null;this._mtlLimitsLoad?.controller.abort();this._mtlLimitsLoad=null;this.mtlLimitsLoading=false;},
            mtlLimitsReset(){
                this.mtlLimitsStop();this._mtlLimitsSave?.controller.abort();this._mtlLimitsSave=null;this._mtlLimitsBody=null;this._mtlLimitsOwner=null;this._mtlLimitsDenied=false;
                this.mtlLimitsState=null;this.mtlLimitsDraft={};this.mtlLimitsDraftRevision=null;this.mtlLimitsUnsupported=false;this.mtlLimitsSaving=false;
                this.mtlLimitsLoadError='';this.mtlLimitsSaveError='';this.mtlLimitsPending=false;
            },
            mtlLimitsStart(){clearTimeout(this._mtlLimitsTimer);this.mtlLimitsLoad();},
            mtlLimitsSchedule(){
                clearTimeout(this._mtlLimitsTimer);
                if(this.mtlLimitsOpen&&!this.mtlLimitsUnsupported&&!this._mtlLimitsDenied)this._mtlLimitsTimer=setTimeout(()=>{
                    if(root.document?.hidden||root.navigator?.onLine===false)this.mtlLimitsSchedule();else this.mtlLimitsLoad();
                },5000);
            },
            mtlLimitsPublish(input,owner,{saved=false,conflict=false}={}){
                if(!current(this,owner))return false;
                const value=sanitize(input,this.cloudUser.id),replace=saved||!this.mtlLimitsState||!this.mtlLimitsDirty&&!this.mtlLimitsPending;
                if(this.mtlLimitsState&&value.revision<this.mtlLimitsState.revision)return false;
                this._mtlLimitsOwner=owner;this.mtlLimitsState=value;if(replace)this.mtlLimitsDraft=copy(value.limits);
                if(replace||conflict)this.mtlLimitsDraftRevision=value.revision;
                this.mtlLimitsUnsupported=false;return true;
            },
            async mtlLimitsLoad(manual=false){
                if(this._mtlLimitsOwner&&!current(this,this._mtlLimitsOwner))this.mtlLimitsReset();
                if(!allowed(this)||this.mtlLimitsLoading||this.mtlLimitsSaving||this._mtlLimitsDenied&&!manual)return false;
                const owner={client:this._cloud,key:access(this)},run=this._mtlLimitsLoad={controller:new AbortController()};this._mtlLimitsOwner=owner;this.mtlLimitsLoading=true;
                try{
                    const response=await owner.client.request(base,{signal:run.controller.signal});
                    if(this._mtlLimitsLoad!==run||run.controller.signal.aborted||!current(this,owner))return false;
                    if(!this.mtlLimitsPublish(response?.quota,owner))throw new TypeError('Invalid MTL quota revision.');
                    this.mtlLimitsLoadError='';this._mtlLimitsDenied=false;return true;
                }catch(error){
                    if(this._mtlLimitsLoad===run&&current(this,owner)&&!run.controller.signal.aborted&&!error.stale){
                        if([404,501].includes(error.status||error.statusCode)){this.mtlLimitsUnsupported=true;this.mtlLimitsLoadError='';}
                        else if([401,403].includes(error.status||error.statusCode)){
                            this.mtlLimitsState=null;this.mtlLimitsDraft={};this._mtlLimitsBody=null;this.mtlLimitsPending=false;this.mtlLimitsSaveError='';
                            this._mtlLimitsDenied=true;this.mtlLimitsLoadError='Administrator access is required to view MTL limits and usage.';
                        }else this.mtlLimitsLoadError='MTL limits and usage could not be loaded. The last displayed values are unchanged.';
                    }
                    return false;
                }finally{
                    if(this._mtlLimitsLoad===run){this._mtlLimitsLoad=null;this.mtlLimitsLoading=false;this.mtlLimitsSchedule();}
                }
            },
            async mtlLimitsSave(){
                if(!this.mtlLimitsCanSave||!current(this,this._mtlLimitsOwner))return false;
                this.mtlLimitsStop();
                const owner={client:this._cloud,key:access(this)},run=this._mtlLimitsSave={controller:new AbortController()};
                this._mtlLimitsBody ||= {expectedRevision:this.mtlLimitsDraftRevision,mutationId:root.crypto.randomUUID(),limits:copy(this.mtlLimitsDraft)};
                const body=copy(this._mtlLimitsBody);this.mtlLimitsPending=true;this.mtlLimitsSaving=true;
                try{
                    const response=await owner.client.request(base,{method:'PUT',body,signal:run.controller.signal});
                    if(this._mtlLimitsSave!==run||run.controller.signal.aborted||!current(this,owner))return false;
                    if(response?.quota?.mutationId!==body.mutationId||!integer(response.quota.appliedRevision)||response.quota.appliedRevision<1||response.quota.appliedRevision>response.quota.revision)throw new TypeError('Invalid MTL save receipt.');
                    if(!this.mtlLimitsPublish(response.quota,owner,{saved:true}))throw new TypeError('Invalid MTL save revision.');
                    this._mtlLimitsBody=null;this.mtlLimitsPending=false;
                    this.mtlLimitsSaveError='';this.mtlLimitsLoadError='';return true;
                }catch(error){
                    if(this._mtlLimitsSave===run&&current(this,owner)&&!run.controller.signal.aborted&&!error.stale){
                        const status=error.status||error.statusCode,definite=status>=400&&status<500&&![408,429].includes(status);
                        if(definite){this._mtlLimitsBody=null;this.mtlLimitsPending=false;}
                        if(status===409&&error.code==='MTL_LIMITS_CHANGED'){
                            const value=error.details?.quota||error.current?.quota;
                            try{this.mtlLimitsPublish(value,owner,{conflict:true});}catch(_){}
                            this.mtlLimitsSaveError='Limits changed on the server. Compare the current limits with your edits, then Save again.';
                        }else if([401,403].includes(status)){
                            this._mtlLimitsDenied=true;this.mtlLimitsState=null;this.mtlLimitsDraft={};this.mtlLimitsSaveError='Administrator access is required to save MTL limits.';
                        }
                        else this.mtlLimitsSaveError=definite?'MTL limits were not saved. Review your values and try again.'
                            :'The save could not be confirmed. Retry Save to confirm the same change; its request ID is preserved.';
                    }
                    return false;
                }finally{
                    if(this._mtlLimitsSave===run){this._mtlLimitsSave=null;this.mtlLimitsSaving=false;this.mtlLimitsSchedule();}
                }
            },
            mtlLimitsBucket(row){return this.mtlLimitsState?.usage[row.group]?.[row.bucket];},
            mtlLimitsResetText(row){
                const bucket=this.mtlLimitsBucket(row),zone=this.mtlLimitsState?.usage.timezone;
                if(!bucket)return '';
                if(row.bucket==='concurrency')return 'When requests finish';
                const format=value=>new Intl.DateTimeFormat(undefined,{timeZone:zone,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
                if(row.bucket==='minute')return bucket.resetsAt===null?'Rolling 60 seconds; window empty':'Next release '+format(bucket.resetsAt)+'; fully clears '+format(bucket.fullyResetsAt);
                return format(bucket.resetsAt);
            },
        },
    };
    return{mixin,rows,sanitize,allowed};
});
