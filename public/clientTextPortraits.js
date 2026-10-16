/* Display-only identities. Image bytes and acquisition metadata belong to the API. */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.ClientTextPortraits = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    const VERSION = '4';
    const catalog = root.ClientTextPortraitCatalog || (typeof require === 'function' ? require('./clientTextPortraitCatalog.js') : { games:{} });
    const own = (object,key) => Object.prototype.hasOwnProperty.call(object || {},key);
    const references = value => typeof value === 'string' ? [...new Set(value.split(/[,\r\n]+/u).map(x=>x.trim()).filter(Boolean))] : [];
    function createResolver({ npcIndex, convoIndex, game }) {
        const registry=own(catalog.games,game) ? catalog.games[game] : {npcs:{},characters:{},labels:{},overrides:{}};
        const paths = new Map();
        for (const group of npcIndex?.groups || []) for (const path of group.paths) {
            if (!paths.has(path)) paths.set(path, new Set());
            paths.get(path).add(group.key);
        }
        function npc(key, references, entryForNpc) {
            const group = npcIndex?.groupByKey.get(key);
            if (!group) return null;
            const candidates=references?.length ? references : group.paths;
            const entries=candidates.map(path=>entryForNpc(path)),ids=[...new Set(entries.map(item=>item?.[0]).filter(Boolean))];
            // A name group can contain several forms. Only an unambiguous exact mapping supplies art.
            const id=ids.length===1 && entries.every(item=>item?.[0]) ? ids[0] : '';
            return { key:id ? 'portrait:'+game+':'+id : 'npc:'+key, id, game, name:group.label, paths:candidates };
        }
        return unit => {
            if (!unit) return [];
            const result=[],seen=new Set();
            const add=(item,relation)=>{
                if(!item || seen.has(item.key))return;
                seen.add(item.key);result.push({...item,relation,provisional:!!registry.labels[item.id]?.provisional});
            };
            const npcRefs=references(unit.metadata?.NPC);
            const override=unit.sheet?.replace(/_Gender$/,'')==='NPCTextAudio' && own(registry.overrides,unit.recordId) ? registry.overrides[unit.recordId] : null;
            const entryForNpc=path=>{
                const entry=own(registry.npcs,path) ? registry.npcs[path] : null;
                return override?.npcs.includes(path) && npcRefs.includes(path) ? [override.id,entry?.[1] || registry.labels[override.id]?.name] : entry;
            };
            const direct=(entry,paths)=>({key:entry[0] ? 'portrait:'+game+':'+entry[0] : 'character:'+paths[0],id:entry[0],game,name:entry[1],paths});
            const family=convoIndex?.memberships.get(unit.id);
            if(family?.parentKey && family.parentKey!=='unassigned'){
                const group=npcIndex?.groupByKey.get(family.parentKey),current=npcRefs.filter(path=>group?.paths.includes(path));
                const evidence=family.npcEvidence?.participants.find(item=>item.key===family.parentKey)?.references;
                add(npc(family.parentKey,current.length ? current : evidence,entryForNpc),'Conversation NPC');
            }
            // Non-conversation rows can have one or several exact/inferred NPC links.
            if(!family)for(const key of npcIndex?.memberships.get(unit.id)?.keys() || []){
                const group=npcIndex.groupByKey.get(key),refs=unit.sheet==='NPCs' ? [unit.recordId] : npcRefs.filter(path=>group.paths.includes(path));
                add(npc(key,refs,entryForNpc),'NPC');
            }
            for(const path of references(unit.metadata?.Character)){
                const entry=own(registry.characters,path) && registry.characters[path];
                if(entry)add(direct(entry,[path]),'Character');
            }
            for(const path of npcRefs){
                const owners=paths.get(path);
                if(owners?.size===1)add(npc(owners.values().next().value,[path],entryForNpc),'NPC reference');
                else if(!owners?.size){const entry=entryForNpc(path);if(entry)add(direct(entry,[path]),'NPC reference');}
            }
            return result;
        };
    }
    function portraitUrl(id,game='poe2') {
        if(!['poe1','poe2'].includes(game) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '') || typeof root.CloudUI?.apiBase!=='function')return '';
        try { return root.CloudUI.apiBase()+'/portraits/'+game+'/'+encodeURIComponent(id)+'.webp?v='+VERSION; }
        catch (_) { return ''; }
    }
    const component = {
        name:'ClientTextPortraits',props:{items:{type:Array,default:()=>[]}},data(){return {failed:{},expanded:false};},
        mounted(){this._online=()=>{this.failed={};};root.addEventListener?.('online',this._online);},
        beforeUnmount(){root.removeEventListener?.('online',this._online);},
        methods:{url:portraitUrl,tooltip(item){return item.relation+': '+item.name+'\n'+item.paths.join('\n')+(item.provisional?'\nProvisional class portrait; review at PoE2 1.0.':'')+(item.id && !this.failed[this.url(item.id,item.game)]?'':'\nPortrait unavailable.');},
            keydown(event){if(event.key==='Escape')this.expanded=false;}},
        template:`<span v-if="items.length" class="ctPortraitStack" :class="{ctPortraitMultiple:items.length>1,ctPortraitExpanded:expanded && items.length>2}" :style="{'--ct-portrait-count':Math.min(items.length,4)}" role="group" :aria-label="'Related characters: '+items.map(item=>item.name).join(', ')" :tabindex="items.length>2?0:undefined" @mouseenter="expanded=true" @mouseleave="expanded=$el.contains($el.ownerDocument.activeElement)" @focusin="expanded=true" @focusout="expanded=$el.contains($event.relatedTarget)" @keydown.stop="keydown">
            <span class="ctPortraitCards">
            <span v-for="(item,index) in (expanded?items:items.slice(0,4))" :key="item.key" class="ctPortrait" :style="{zIndex:items.length-index}" role="img" :aria-label="item.relation+': '+item.name+(item.provisional?' (provisional)':'')" :title="tooltip(item)">
                <img v-if="item.id && url(item.id,item.game) && !failed[url(item.id,item.game)]" :src="url(item.id,item.game)" alt="" width="160" height="180" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="failed[url(item.id,item.game)]=true">
                <span v-else class="ctPortraitMissing" aria-hidden="true">{{item.name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('')}}</span>
                <small class="ctPortraitCaption" aria-hidden="true">{{item.name}}{{item.provisional?' *':''}}</small>
            </span>
            <span v-if="!expanded && items.length>4" class="ctPortraitMore" aria-hidden="true">+{{items.length-4}}</span>
            </span>
        </span>`,
    };
    return { createResolver, portraitUrl, references, component };
});
