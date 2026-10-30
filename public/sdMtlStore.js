/* Private per-field SD suggestions. No baseline/source text or prompt is stored here. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.SDMtlStore=api;})(typeof window!=='undefined'?window:globalThis,function(root){
    'use strict';
    const copy=v=>JSON.parse(JSON.stringify(v));
    function create({openDb=()=>root.OfflineStore.openClientTextDb(),memory=false}={}){
        const rows=new Map();
        const read=async scopeKey=>{
            if(memory)return [...rows.values()].filter(r=>r.scopeKey===scopeKey).map(copy);
            const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(['sd_mtl'],'readonly'),req=tx.objectStore('sd_mtl').index('by_scope').getAll(scopeKey);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
        };
        const put=async(row,expected,guard=()=>true)=>{
            const value=copy(row);
            const check=current=>{if(!guard())throw new Error('The SD MTL context changed.');if(expected!==undefined&&(current?.revision||0)!==expected)throw new Error('Another tab changed this MTL review. Reopen this file to compare it.');return {...value,revision:(current?.revision||0)+1};};
            if(memory){const current=rows.get(value.key),next=check(current);if(current&&current.requestId!==next.requestId)rows.set(current.key+':resolved:'+current.requestId,{...copy(current),key:current.key+':resolved:'+current.requestId,archived:true});rows.set(next.key,next);return copy(next);}
            const db=await openDb();return new Promise((resolve,reject)=>{
                const tx=db.transaction(['sd_mtl'],'readwrite'),store=tx.objectStore('sd_mtl'),req=store.get(value.key);let next,failure;
                req.onsuccess=()=>{try{next=check(req.result);if(req.result&&req.result.requestId!==next.requestId)store.put({...req.result,key:req.result.key+':resolved:'+req.result.requestId,archived:true});store.put(next);}catch(error){failure=error;tx.abort();}};
                tx.oncomplete=()=>resolve(next);tx.onabort=tx.onerror=()=>reject(failure||tx.error||new Error('Could not retain the MTL review.'));
            });
        };
        return {read,put};
    }
    return {create};
});
