/* Browser-private, field-scoped TM candidates and review buffers. */
(function(root,factory){
    const node=typeof module==='object'&&module.exports;
    const api=factory(root,node?require('./clientTextState.js'):root.ClientTextState,node?require('./clientTextTmState.js'):root.ClientTextTmState);
    if(node)module.exports=api;else root.ClientTextTmStore=api;
})(typeof globalThis==='object'?globalThis:self,function(root,S,T){
    'use strict';
    const C=()=>root.ClientTextStore||(typeof require==='function'?require('./clientTextStore.js'):null);
    const stores=Object.freeze({candidates:'clienttext_tm_candidates',reviews:'clienttext_tm_reviews'}),names=Object.freeze(Object.values(stores));
    const mtlStores=['clienttext_mtl_candidates','clienttext_mtl_meta'];
    const key=(...parts)=>JSON.stringify(parts),reviewId=(unitId,fieldId)=>key(unitId,fieldId);
    const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    const complete=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||new Error('TM review transaction aborted.'));});
    const get=async(tx,name,scope,id)=>(await request(tx.objectStore(name).get(key(scope,id))))?.value;
    const put=(tx,name,scope,id,value)=>tx.objectStore(name).put({key:key(scope,id),scope,unitKey:key(scope,value.unitId),value:S.copy(value)});
    const guard=options=>{if(options?.signal?.aborted||options?.guard&&!options.guard())throw Object.assign(new Error('The TM review workspace changed.'),{stale:true,name:'AbortError'});};
    function upgrade(db,tx){for(const name of names){const store=db.objectStoreNames.contains(name)?tx.objectStore(name):db.createObjectStore(name,{keyPath:'key'});for(const[index,path]of[['by_scope','scope'],['by_unit','unitKey']])if(!store.indexNames.contains(index))store.createIndex(index,path);}}
    function normalizeReview(unitId,fieldId,input,previous){
        if(!input||typeof input.candidateId!=='string'||!input.candidateId||!Number.isSafeInteger(input.candidateRevision)||input.candidateRevision<1
            ||typeof input.text!=='string'||input.text.length>T.MAX_TEXT||!/^[a-f0-9]{64}$/.test(input.rawSourceHash||'')
            ||input.matchId!=null&&typeof input.matchId!=='string')throw new TypeError('Invalid TM review buffer.');
        const result={unitId,fieldId,candidateId:input.candidateId,candidateRevision:input.candidateRevision,rawSourceHash:input.rawSourceHash,
            text:input.text,matchId:input.matchId??null,dirty:!!input.dirty,opened:!!input.opened,acceptedDraft:!!input.acceptedDraft,
            revision:(previous?.revision||0)+1,createdAt:previous?.createdAt||Date.now(),updatedAt:Date.now()};
        for(const name of ['previousValue','previousDraft','restored'])if(Object.hasOwn(input,name))result[name]=S.copy(input[name]);
        return result;
    }
    function normalizeRecovery(unitId,fieldId,input,options,previous){
        const recoveryId=options?.recoveryId,editRevision=options?.editRevision;
        if(typeof recoveryId!=='string'||!recoveryId||recoveryId.length>256||!Number.isSafeInteger(editRevision)||editRevision<1)throw new TypeError('Invalid TM review recovery identity.');
        const review=normalizeReview(unitId,fieldId,input,null),body=Object.fromEntries(['unitId','fieldId','candidateId','candidateRevision','rawSourceHash','text','matchId','dirty','opened','acceptedDraft']
            .map(name=>[name,review[name]]));
        if(typeof input.previousValue==='string')body.previousValue=input.previousValue;
        const signature=S.hash(body);
        if(previous){
            if(previous.candidateId!==body.candidateId||previous.rawSourceHash!==body.rawSourceHash)throw Object.assign(new Error('A TM recovery ID was reused for another field source.'),{code:'TM_RECOVERY_MISMATCH'});
            if(editRevision<previous.editRevision)return S.copy(previous);
            if(editRevision===previous.editRevision){if(signature!==previous.signature)throw Object.assign(new Error('A TM review recovery revision was reused.'),{code:'TM_RECOVERY_MISMATCH'});return S.copy(previous);}
        }
        return {...body,recoveryId,editRevision,signature,reason:'review-conflict',createdAt:previous?.createdAt||Date.now(),updatedAt:Date.now(),revision:(previous?.revision||0)+1};
    }
    async function validateAcceptancesTx(tx,rawScope,unit,claims,values,descriptor,baseValues){
        const scope=C().scopeKey(rawScope),candidates=[];
        for(const claim of claims||[])candidates.push(await get(tx,stores.candidates,scope,claim.candidateId));
        const accepted=T.validateAcceptances(candidates.filter(Boolean),unit,claims||[],values,descriptor,baseValues);
        for(const claim of accepted){const review=await get(tx,stores.reviews,scope,reviewId(unit.id,claim.fieldId));
            if(!review?.acceptedDraft||review.candidateId!==claim.candidateId||review.candidateRevision!==claim.candidateRevision||review.matchId!==claim.matchId)throw T.changed();}
        return accepted;
    }
    async function resolveAcceptancesTx(tx,rawScope,claims,options={}){
        const scope=C().scopeKey(rawScope);
        for(const claim of claims){
            const candidate=await get(tx,stores.candidates,scope,claim.candidateId);
            if(!candidate||candidate.status!=='pending'||candidate.revision!==claim.candidateRevision)throw T.changed();
            put(tx,stores.candidates,scope,candidate.id,{...candidate,status:'accepted',revision:candidate.revision+1,
                resolvedAt:options.now||Date.now(),acceptanceJobId:options.jobId,reviewedTextHash:claim.reviewedTextHash});
            const review=await get(tx,stores.reviews,scope,reviewId(claim.unitId,claim.fieldId));
            if(review)put(tx,stores.reviews,scope,reviewId(claim.unitId,claim.fieldId),{...review,acceptedDraft:false,resolved:true,revision:review.revision+1});
        }
    }
    function create(dependencies={}){
        const open=dependencies.openDb||(()=>root.OfflineStore.openClientTextDb());
        async function transaction(selected,mode,action,options){
            guard(options);const db=await open();guard(options);let tx;
            try{tx=db.transaction([...new Set(selected)],mode,mode==='readwrite'?{durability:'strict'}:{});}catch(error){if(!(error instanceof TypeError))throw error;tx=db.transaction([...new Set(selected)],mode);}
            const done=complete(tx);try{const result=await Promise.race([action(tx),done.then(()=>new Promise(()=>{}))]);guard(options);await done;return result;}catch(error){try{tx.abort();}catch(_){}await done.catch(()=>{});throw error;}
        }
        const scoped=(rawScope,options)=>{guard(options);const scope=C().normalizeScope(rawScope);return {scope,id:C().scopeKey(scope)};};
        async function localGuard(tx,scope,promote=true){
            if(!scope.groupId.startsWith('local:test:'))return;
            const metadata=await get(tx,C().stores.meta,C().scopeKey(scope),'meta');C().validateLocalMetadata(scope,metadata);
            if(!metadata||metadata.localRestorePending)throw new Error('The local workbook is not ready.');
            if(promote&&metadata.localProtocol!=='clienttext-local-v3'){metadata.localProtocol='clienttext-local-v3';tx.objectStore(C().stores.meta).put({key:key(C().scopeKey(scope),'meta'),scope:C().scopeKey(scope),accountId:scope.accountId,value:metadata});}
        }
        const writeStores=scope=>scope.groupId.startsWith('local:test:')?[...names,C().stores.meta]:names;
        async function list(rawScope,options){const{id}=scoped(rawScope,options);return transaction([stores.candidates],'readonly',async tx=>(await request(tx.objectStore(stores.candidates).index('by_scope').getAll(id))).map(row=>row.value),options);}
        async function getCandidate(rawScope,id,options){const captured=scoped(rawScope,options);return transaction([stores.candidates],'readonly',tx=>get(tx,stores.candidates,captured.id,id),options);}
        async function reviewRows(rawScope,unitId,options){const{id}=scoped(rawScope,options);return transaction([stores.reviews],'readonly',async tx=>(await request(tx.objectStore(stores.reviews).index(unitId?'by_unit':'by_scope').getAll(unitId?key(id,unitId):id))).map(row=>row.value),options);}
        async function listReviews(rawScope,unitId,options){if(unitId&&typeof unitId==='object'){options=unitId;unitId=null;}return(await reviewRows(rawScope,unitId,options)).filter(value=>!value.recoveryId&&(options?.includeArchived||!value.archived));}
        async function listRecoveries(rawScope,unitId,options){if(unitId&&typeof unitId==='object'){options=unitId;unitId=null;}return(await reviewRows(rawScope,unitId,options)).filter(value=>value.recoveryId&&value.reason==='review-conflict');}
        async function getReview(rawScope,unitId,fieldId,options){const{id}=scoped(rawScope,options);return transaction([stores.reviews],'readonly',tx=>get(tx,stores.reviews,id,reviewId(unitId,fieldId)),options);}
        async function putBatch(rawScope,input,options={}){
            const {scope,id}=scoped(rawScope,options),candidates=input.map(T.normalizeCandidate);
            if(candidates.length>128||candidates.some(candidate=>candidate.status!=='pending'||candidate.revision!==1))throw new TypeError('TM candidate writes require new pending suggestions in batches of at most 128.');
            const core=C(),source=core.create({openDb:open}),units=await source.getUnitsByIds(scope,[...new Set(candidates.map(value=>value.unitId))],options);
            const byId=new Map(units.map(unit=>[unit.id,unit]));
            return transaction([...writeStores(scope),...mtlStores,core.stores.meta,core.stores.saved,core.stores.drafts,core.stores.cacheUnits],'readwrite',async tx=>{
                await localGuard(tx,scope,false);const added=[],existingByUnit=new Map(),mtlByUnit=new Map();
                for(const candidate of candidates){guard(options);
                    const prepared=byId.get(candidate.unitId);
                    const metadata=await get(tx,core.stores.meta,id,'meta'),descriptor=metadata?.descriptors?.find(value=>value.role===candidate.role);
                    const original=metadata?.originalCaches?.[candidate.role]&&await get(tx,core.stores.cacheUnits,metadata.originalCaches[candidate.role],candidate.unitId);
                    const unit=original?.unit,field=unit?.fields.find(field=>field.id===candidate.fieldId);
                    if(!unit||unit.id!==prepared?.id)throw T.changed();
                    if(!T.applicable(candidate,field,{...descriptor,unitId:unit?.id}))throw T.changed();
                    const saved=await get(tx,core.stores.saved,id,unit.id),draft=await get(tx,core.stores.drafts,id,unit.id);
                    const currentValue=S.valuesFor(unit,saved)[field.id]??'';
                    if(candidate.baseTargetHash!==T.targetHash(currentValue)||String(currentValue).trim()||String(draft?.values?.[field.id]??'').trim()
                        ||S.englishIntentFor(field,saved,{game:scope.game})||!S.statusFor(unit,saved,{game:scope.game}).fields[field.id]?.missing)continue;
                    let competitors=mtlByUnit.get(unit.id);
                    if(!competitors){competitors=(await Promise.all(mtlStores.map(name=>request(tx.objectStore(name).index('by_scope_unit').getAll([id,unit.id]))))).flat().map(row=>row.value);mtlByUnit.set(unit.id,competitors);}
                    const mtl=root.ClientTextMtlState||(typeof require==='function'?require('./clientTextMtlState.js'):null);
                    if(competitors.some(value=>value.fieldId===field.id&&value.rawSourceHash===mtl.rawSourceHash(field.source)&&value.assetHash===descriptor.assetHash
                        &&value.parserVersion===descriptor.parserVersion&&(value.kind==='generation'?['pending','uncertain'].includes(value.status):value.status==='pending')))continue;
                    let existing=existingByUnit.get(unit.id);
                    if(!existing){existing=(await request(tx.objectStore(stores.candidates).index('by_unit').getAll(key(id,unit.id)))).map(row=>row.value);existingByUnit.set(unit.id,existing);}
                    if(existing.some(value=>value.fieldId===field.id&&value.status==='pending'))continue;
                    const previous=await get(tx,stores.candidates,id,candidate.id);
                    if(previous){if(T.immutable(previous)!==T.immutable(candidate))throw T.changed();continue;}
                    put(tx,stores.candidates,id,candidate.id,candidate);added.push(candidate);existing.push(candidate);
                }
                if(added.length)await localGuard(tx,scope);return added;
            },options);
        }
        async function putReview(rawScope,unitId,fieldId,input,options={}){const{scope,id}=scoped(rawScope,options),detached=S.copy(input);
            return transaction(writeStores(scope),'readwrite',async tx=>{await localGuard(tx,scope);const previous=await get(tx,stores.reviews,id,reviewId(unitId,fieldId));
                if(Object.hasOwn(options,'expectedRevision')&&(previous?.revision||null)!==options.expectedRevision)throw Object.assign(new Error('This TM review changed in another tab.'),{code:'TM_REVIEW_CHANGED'});
                const candidate=await get(tx,stores.candidates,id,detached.candidateId);
                if(!candidate||candidate.status!=='pending'||candidate.unitId!==unitId||candidate.fieldId!==fieldId||candidate.revision!==detached.candidateRevision
                    ||candidate.rawSourceHash!==detached.rawSourceHash||detached.matchId!=null&&!candidate.matches.some(match=>match.id===detached.matchId))throw T.changed();
                if(detached.acceptedDraft&&(!detached.matchId||candidate.restored||candidate.overflow))throw T.changed();
                if(previous&&previous.candidateId!==detached.candidateId)put(tx,stores.reviews,id,key('archive',unitId,fieldId,previous.candidateId),{...previous,archived:true});
                const value=normalizeReview(unitId,fieldId,detached,previous);put(tx,stores.reviews,id,reviewId(unitId,fieldId),value);return value;
            },options);
        }
        async function dismiss(rawScope,candidate,options={}){const{scope,id}=scoped(rawScope,options);return transaction(writeStores(scope),'readwrite',async tx=>{await localGuard(tx,scope);
            const current=await get(tx,stores.candidates,id,candidate.id);
            if(current?.status==='dismissed'&&T.immutable(current)===T.immutable(candidate))return current;
            if(!current||current.status!=='pending'||current.revision!==(options.expectedRevision??candidate.revision)||T.immutable(current)!==T.immutable(candidate))throw T.changed();
            const next={...current,status:'dismissed',revision:current.revision+1,resolvedAt:Date.now()};put(tx,stores.candidates,id,current.id,next);return next;
        },options);}
        async function revalidate(rawScope,candidate,options={}){const{scope,id}=scoped(rawScope,options),next=T.normalizeCandidate(candidate);
            delete next.restored;
            return transaction([...writeStores(scope),C().stores.drafts],'readwrite',async tx=>{await localGuard(tx,scope);
                const current=await get(tx,stores.candidates,id,next.id);
                if(!current||current.status!=='pending'||current.revision!==options.expectedRevision||next.revision!==current.revision+1
                    ||['unitId','fieldId','role','assetHash','parserVersion','source','rawSourceHash','baseTargetHash'].some(name=>current[name]!==next[name]))throw T.changed();
                const review=await get(tx,stores.reviews,id,reviewId(current.unitId,current.fieldId));
                const draft=review?.acceptedDraft?await get(tx,C().stores.drafts,id,current.unitId):null;
                if(draft?.tmAcceptances?.some(claim=>claim.candidateId===current.id&&claim.fieldId===current.fieldId))throw new Error('Undo acceptance before refreshing the TM suggestion.');
                put(tx,stores.candidates,id,next.id,next);
                if(review)put(tx,stores.reviews,id,reviewId(current.unitId,current.fieldId),{...review,candidateRevision:next.revision,matchId:null,acceptedDraft:false,restored:false,revision:review.revision+1});
                return next;
            },options);
        }
        async function putRecovery(rawScope,unitId,fieldId,input,options={}){const{scope,id}=scoped(rawScope,options),detached=S.copy(input);
            return transaction(writeStores(scope),'readwrite',async tx=>{await localGuard(tx,scope);
                const recordId=key('recovery',unitId,fieldId,options.recoveryId),previous=await get(tx,stores.reviews,id,recordId);
                const next=normalizeRecovery(unitId,fieldId,detached,options,previous);put(tx,stores.reviews,id,recordId,next);return next;
            },options);
        }
        return {list,get:getCandidate,getCandidate,putBatch,getReview,putReview,dismiss,listReviews,revalidate,putRecovery,listRecoveries};
    }
    return {stores,names,upgrade,normalizeReview,normalizeRecovery,guard,create,validateAcceptancesTx,resolveAcceptancesTx};
});
