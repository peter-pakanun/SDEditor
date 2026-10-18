/* Per-Admin next-request choices. No workspace values or global defaults are written. */
(function(root,factory){
    const api=factory(root);
    if(typeof module==='object'&&module.exports)module.exports=api;else root.ClientTextMtlSettingsUI=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
    'use strict';
    const VERSION='mtl-inference-settings-v1',DEFAULT={version:VERSION,model:'gpt-6.1-sol',effort:'medium'};
    const POLICY={'gpt-6-luna':['high','xhigh','max'],'gpt-6.1-sol':['low','medium','high','xhigh','max']};
    const raw=value=>root.Vue?.markRaw?root.Vue.markRaw(value):value;
    const allowed=host=>host.cloudSignedIn===true&&host.cloudUser?.isAdmin===true&&host.cloudUser.role==='admin'
        &&!!host.cloudUser.id&&host.cloudUser.id===host.cloudProfileId&&host.cloudUser.id===host.ctWorkspace?.scope?.accountId
        &&!!host._cloud&&!host._cloud.destroyed;
    const fence=host=>JSON.stringify([host.cloudSignedIn,host.cloudProfileId,host.cloudUser?.id,host.cloudUser?.role,
        host.cloudUser?.isAdmin,host.cloudUser?.assignmentVersion,host._cloud?.epoch,host.ctWorkspace?.scope?.accountId]);
    function settings(value){
        if(!value||value.version!==VERSION||typeof value.model!=='string'||!Object.hasOwn(POLICY,value.model)||!POLICY[value.model].includes(value.effort))
            throw new Error('Choose an available translation model and reasoning effort.');
        return {version:VERSION,model:value.model,effort:value.effort};
    }
    function catalog(value){
        if(value?.version!==VERSION||!Array.isArray(value.models)||value.models.length>2)throw new Error('The server needs an upgrade before model settings can be used.');
        const used=new Set();
        return {models:value.models.map(item=>{
            if(typeof item?.model!=='string'||!Object.hasOwn(POLICY,item.model)||used.has(item.model)||!Array.isArray(item.efforts)
                ||!item.efforts.length||item.efforts.some(effort=>!POLICY[item.model].includes(effort)))throw new Error('The translation model list could not be verified.');
            used.add(item.model);return {model:item.model,label:item.model==='gpt-6-luna'?'GPT-6 Luna':'GPT-6.1 Sol',efforts:[...new Set(item.efforts)]};
        })};
    }
    const mixin={
        data:()=>({ctMtlSettingsOwner:null,ctMtlSettingsPanel:'',ctMtlSettingsChoice:null,ctMtlSettingsCatalog:null,ctMtlSettingsLoading:false,ctMtlSettingsError:''}),
        computed:{ctMtlSettingsAllowed(){return allowed(this);},ctMtlSettingsOrigin(){return fence(this);}},
        watch:{ctMtlSettingsOrigin(){this.ctMtlSettingsReset();},ctSelection(){this.ctMtlSettingsPanel='';}},
        beforeUnmount(){this.ctMtlSettingsReset();},
        methods:{
            ctMtlSettingsReset(){this.ctMtlSettingsOwner=null;this._ctMtlSettingsLoad=null;this.ctMtlSettingsPanel='';this.ctMtlSettingsChoice=null;this.ctMtlSettingsCatalog=null;this.ctMtlSettingsLoading=false;this.ctMtlSettingsError='';},
            ctMtlSettingsFor(field){return allowed(this)&&this.ctMtlSettingsPanel===field.id?this:null;},
            ctMtlSettingsSelected(){return settings(this.ctMtlSettingsOwner?.client===this._cloud&&this.ctMtlSettingsOwner?.fence===fence(this)&&allowed(this)?this.ctMtlSettingsChoice||DEFAULT:DEFAULT);},
            ctMtlSettingsCapture(){
                if(!allowed(this)||!this.ctMtlSettingsChoice||this.ctMtlSettingsOwner?.client!==this._cloud||this.ctMtlSettingsOwner?.fence!==fence(this))return undefined;
                const value=settings(this.ctMtlSettingsChoice),available=this.ctMtlSettingsCatalog?.models.find(item=>item.model===value.model);
                if(!available?.efforts.includes(value.effort))throw new Error('The selected model is unavailable. Open Model settings or use the default.');
                return value;
            },
            async ctMtlSettingsToggle(field){
                if(!allowed(this)||!this.ctCurrentUnit?.fields.includes(field))return false;
                if(this.ctMtlSettingsPanel===field.id){this.ctMtlSettingsPanel='';return false;}
                this.ctMtlSettingsPanel=field.id;
                const client=this._cloud,origin=fence(this),load=raw({});this._ctMtlSettingsLoad=load;
                this.ctMtlSettingsLoading=true;this.ctMtlSettingsError='';
                const current=()=>this._ctMtlSettingsLoad===load&&client===this._cloud&&origin===fence(this)&&allowed(this);
                try{
                    const response=await client.request('/v1/admin/mtl/model-settings');
                    if(!current())return false;
                    this.ctMtlSettingsCatalog=catalog(response.settings);this.ctMtlSettingsOwner=raw({client,fence:origin});
                    if(!this.ctMtlSettingsCatalog.models.length)this.ctMtlSettingsError='Neither permitted model is listed for the connected translation account. Default generation remains unchanged.';
                    return true;
                }catch(error){if(current())this.ctMtlSettingsError=error?.status===404?'The server needs an upgrade before model settings can be used.':'The translation account model list is unavailable. Close and reopen Model settings to try again. Default generation remains unchanged.';return false;}
                finally{if(current()){this.ctMtlSettingsLoading=false;this._ctMtlSettingsLoad=null;}}
            },
            ctMtlSettingsChoose(name,value){
                if(!allowed(this)||this.ctMtlSettingsOwner?.client!==this._cloud||this.ctMtlSettingsOwner?.fence!==fence(this))return false;
                const previous=this.ctMtlSettingsSelected(),model=name==='model'?value:previous.model,available=this.ctMtlSettingsCatalog?.models.find(item=>item.model===model);
                if(!available)return false;
                const effort=name==='effort'?value:available.efforts.includes(previous.effort)?previous.effort:available.efforts[0];
                if(!available.efforts.includes(effort))return false;
                this.ctMtlSettingsChoice=settings({version:VERSION,model,effort});return true;
            },
            ctMtlSettingsDefault(){if(!allowed(this))return false;this.ctMtlSettingsChoice=null;return true;}
        }
    };
    const Bar={name:'ClientTextMtlSettingsBar',props:{host:{type:Object,required:true}},
        computed:{choice(){return this.host.ctMtlSettingsSelected();},models(){return this.host.ctMtlSettingsCatalog?.models||[];},efforts(){return this.models.find(item=>item.model===this.choice.model)?.efforts||[];}},
        methods:{close(){const button=this.$el.parentElement?.querySelector('.ctMtlSettingsButton');this.host.ctMtlSettingsPanel='';this.$nextTick(()=>button?.focus({preventScroll:true}));}},
        template:'<section role="region" class="ctMtlSettingsBar" aria-label="Translation model settings" data-inline-focus-surface @keydown.esc.stop.prevent="close()"><div class="ctMtlSettingsFields"><label>Model<select aria-label="Model" :value="choice.model" :disabled="host.ctMtlSettingsLoading || !models.length" @change="host.ctMtlSettingsChoose(\'model\',$event.target.value)"><option v-if="!models.some(item=>item.model===choice.model)" :value="choice.model">{{ choice.model===\'gpt-6.1-sol\'?\'GPT-6.1 Sol · default\':choice.model }}</option><option v-for="item in models" :key="item.model" :value="item.model">{{ item.label }}</option></select></label><label>Reasoning<select aria-label="Reasoning" :value="choice.effort" :disabled="host.ctMtlSettingsLoading || !efforts.length" @change="host.ctMtlSettingsChoose(\'effort\',$event.target.value)"><option v-if="!efforts.includes(choice.effort)" :value="choice.effort">{{ choice.effort }}</option><option v-for="effort in efforts" :key="effort" :value="effort">{{ effort }}</option></select></label><label class="ctMtlSettingsFast" title="Fast availability has not been verified for this translation service connection."><input type="checkbox" aria-label="Fast · unavailable" disabled> Fast · unavailable</label><button type="button" @click="host.ctMtlSettingsDefault()">Use default</button><button type="button" @click="close()" aria-label="Close model settings">Close</button></div><p>For your next requests in this sign-in only. In-flight requests keep their settings. Default: Sol / medium. Fast availability is unverified; sampling and output limits are unavailable on this connection.</p><p v-if="host.ctMtlSettingsLoading" role="status">Checking available models…</p><p v-if="host.ctMtlSettingsError" class="ctMtlSettingsError" role="alert">{{ host.ctMtlSettingsError }}</p></section>'};
    return {mixin,Bar,settings,catalog,DEFAULT};
});
