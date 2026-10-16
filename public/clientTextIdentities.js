/* Display labels only. Character paths share the portrait catalog; variants add no artwork. */
(function(root,factory){
    const node=typeof module==='object'&&module.exports;
    const api=factory(root,node?require('./clientTextPortraitCatalog.js'):null);
    if(node)module.exports=api;else root.ClientTextIdentities=api;
})(typeof globalThis==='object'?globalThis:self,function(root,CharacterCatalog){
    'use strict';
    // Installed PoE2 data/balance/ascendancy.datc64, verified 2026-10-16.
    // SHA-256: 9cd8bfe9c74115f12cb0ae6cba1bef6f9289ff58276239c888a6d62c2b851635.
    // Exact Id/Name pairs; DNT-UNUSED rows intentionally have no friendly fallback.
    const variants={poe2:{
        Warrior1:'Titan',Warrior2:'Warbringer',Warrior3:'Smith of Kitava',
        Ranger1:'Deadeye',Ranger3:'Pathfinder',
        Huntress1:'Amazon',Huntress2:'Spirit Walker',Huntress3:'Ritualist',
        Witch1:'Infernalist',Witch2:'Blood Mage',Witch3:'Lich',Witch3b:'Abyssal Lich',
        Sorceress1:'Stormweaver',Sorceress2:'Chronomancer',Sorceress3:'Disciple of Varashta',
        Mercenary1:'Tactician',Mercenary2:'Witchhunter',Mercenary3:'Gemling Legionnaire',
        Druid1:'Oracle',Druid2:'Shaman',
        Monk1:'Martial Artist',Monk2:'Invoker',Monk3:'Acolyte of Chayula',
    }};
    const own=(object,key)=>Object.prototype.hasOwnProperty.call(object || {},key);
    const characters=game=>(CharacterCatalog || root.ClientTextPortraitCatalog)?.games?.[game]?.characters;
    function reference(id,game,{variants:includeVariants=false}={}){
        const entries=characters(game);
        if(own(entries,id))return {label:entries[id][1],kind:'Character'};
        if(includeVariants && own(variants,game) && own(variants[game],id))return {label:variants[game][id],kind:'class variant'};
        return null;
    }
    return {reference};
});
