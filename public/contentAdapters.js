/* Content-mode boundary: editor text and durable evidence keep their raw shape. */
(function(root,factory){
    const node=typeof module==='object'&&module.exports;
    const api=factory(root,node?require('./clientTextState.js'):root.ClientTextState,node?require('./translationMemory.js'):root.TranslationMemory,
        node?require('./clientTextIdentities.js'):null);
    if(node)module.exports=api;else root.ContentAdapters=api;
})(typeof globalThis==='object'?globalThis:self,function(root,State,Memory,Identities){
    'use strict';
    const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
    const normalizeMode=value=>String(value||'statdescription').toLowerCase();
    function runtime(){const state=State||root.ClientTextState;if(!state)throw new Error('ClientText state is unavailable.');return state;}
    function contextFor(unit,field){
        return {filepath:String(unit.sheet),stats:[],condition:'',remarks:'',entryIndex:null,contentMode:'clienttext',
            fieldKind:field.kind,fieldName:field.name,role:unit.role,sheet:unit.sheet,recordId:unit.recordId,fieldId:field.id,...(field.form?{form:field.form}:{})};
    }
    const contextIndexes=new WeakMap();
    // Candidates have exact raw-string offsets. Delimiters and surrounding
    // whitespace remain ordinary text, including literal backslash-n.
    const variantMetadata=name=>/^(?:Prohibited )?Ascendancy Filter$/.test(name);
    function contextCandidates(value,splitIds=false){
        const spans=new Map(),add=(text,start)=>{
            const trimmed=text.trim();if(!trimmed)return;
            const offset=text.indexOf(trimmed),from=start+offset,to=from+trimmed.length;
            spans.set(from+':'+to,{value:trimmed,start:from,end:to});
        };
        add(value,0);
        for(const match of value.matchAll(/[^,\r\n]+/g))add(match[0],match.index);
        for(const match of value.matchAll(/[^\s,;()[\]{}<>"']+\/[^\s,;()[\]{}<>"']+/g))add(match[0],match.index);
        if(splitIds)for(const match of value.matchAll(/[^\s,;()[\]{}<>"']+/g))add(match[0],match.index);
        return [...spans.values()].sort((a,b)=>a.start-b.start||b.end-a.end);
    }
    const structuredPath=value=>/^[^\s,;()[\]{}<>"']+(?:\/[^\s,;()[\]{}<>"']+)+$/.test(value);
    function englishSources(unit){
        const seen=new Set();
        const fields=(unit.fields||[]).filter(field=>{
            if(field?.kind==='gender'||typeof field?.source!=='string'||!field.source.trim())return false;
            const key=JSON.stringify([field.sourceCell||field.name||field.id,field.source]);
            if(seen.has(key))return false;seen.add(key);return true;
        });
        const column=field=>{
            const letters=/^([A-Z]+)[0-9]+$/i.exec(field.sourceCell||'')?.[1];
            return letters?[...letters.toUpperCase()].reduce((value,letter)=>value*26+letter.charCodeAt(0)-64,0):Infinity;
        };
        return fields.sort((left,right)=>column(left)-column(right));
    }
    function cachedContextReferenceIndex(units){return Array.isArray(units)?contextIndexes.get(units):undefined;}
    async function contextReferenceIndex(units,options={}){
        const check=()=>{
            if(options.signal?.aborted||options.guard&&!options.guard())
                throw Object.assign(new Error('Context reference preparation was cancelled.'),{name:'AbortError',stale:true});
        };
        check();const cached=cachedContextReferenceIndex(units);if(cached)return cached;
        const originals=Array.isArray(units)?units:[],candidates=new Set(),index=new Map();
        const pause=options.yield||(()=>new Promise(resolve=>setTimeout(resolve,0))),now=()=>root.performance?.now?.()??Date.now();
        let started=now(),processed=0;
        const checkpoint=async force=>{
            check();if(force||now()-started>=8){await pause();check();started=now();}
        };
        for(const unit of originals){
            for(const [name,value]of Object.entries(unit?.metadata||{}))if(typeof value==='string'&&value.trim())
                for(const candidate of contextCandidates(value,variantMetadata(name)))candidates.add(candidate.value);
            if(++processed%256===0)await checkpoint(false);
        }
        await checkpoint(true);processed=0;
        for(const unit of originals){
            if(candidates.has(unit?.recordId)){
                const fields=englishSources(unit);
                if(!index.has(unit.recordId))index.set(unit.recordId,[]);index.get(unit.recordId).push({unit,fields});
            }
            if(++processed%256===0)await checkpoint(false);
        }
        check();if(Array.isArray(units))contextIndexes.set(units,index);
        return index;
    }
    function referenceTooltip(id,candidates,resolved){
        const preview=text=>{const flat=text.replace(/\r\n|\r|\n/g,' ↵ ');return flat.slice(0,160)+(flat.length>160?'…':'');};
        const details=candidates.slice(0,4).map(({unit,fields})=>{
            const lines=fields.slice(0,2).map(field=>'English '+(field.name||field.id)+': '+preview(field.source)+'\nSource: '+unit.sheet+'!'+(field.sourceCell||'?')+' ('+unit.role+' workbook)');
            if(fields.length>2)lines.push('+'+(fields.length-2)+' more English fields');
            if(!fields.length)lines.push('No nonblank English source\nSource: '+unit.sheet+' ('+unit.role+' workbook)');
            return lines.join('\n');
        });
        if(candidates.length>4)details.push('+'+(candidates.length-4)+' more matching records');
        return (resolved?'Full path: ':'Related matches for: ')+id+'\n\n'+details.join('\n\n');
    }
    function referenceMetadata(unit,index,options={}){
        // Share the portrait catalog's exact, game-scoped Character identities.
        // Browser scripts load the catalog later; resolve it when displaying context.
        const identities=Identities || root.ClientTextIdentities;
        return Object.entries(unit?.metadata||{}).flatMap(([name,value])=>{
            if(typeof value!=='string'||!value.trim())return [];
            const parts=[];let offset=0,matched=false;
            if(index || identities && options.game)for(const span of contextCandidates(value,variantMetadata(name))){
                if(span.start<offset)continue;
                const candidates=index?.get(span.value) || [];
                const identity=identities?.reference(span.value,options.game,{variants:variantMetadata(name)});
                // Worksheet order supplies a generic label without knowing
                // target sheet/column names. Biography and other fields stay
                // in the tooltip; paragraphs are not promoted to inline labels.
                const label=candidates.length===1?candidates[0].fields[0]?.source:undefined;
                const resolved=(structuredPath(span.value) || identity?.kind==='class variant')&&typeof label==='string'&&label.length<=160&&!/[\r\n]/.test(label);
                const fallback=!resolved && identity ? identity.label : '';
                if(!candidates.length && !fallback)continue;
                const tooltip=fallback ? 'Full path: '+span.value+'\nStatic '+identity.kind+' mapping ('+options.game+')'
                    +(candidates.length?'\n\n'+referenceTooltip(span.value,candidates,false):'') : referenceTooltip(span.value,candidates,resolved);
                if(span.start>offset)parts.push({text:value.slice(offset,span.start)});
                parts.push({text:resolved?label:fallback || span.value,tooltip});
                offset=span.end;matched=true;
            }
            if(offset<value.length)parts.push({text:value.slice(offset)});
            return [{name,value,parts,...(matched?{display:parts.map(part=>part.text).join('')}:{})}];
        });
    }
    function compatibleContext(left,right){
        return normalizeMode(left?.contentMode)===normalizeMode(right?.contentMode)
            && ['fieldKind','form'].every(field=>String(left?.[field]||'')===String(right?.[field]||''));
    }
    function memoryUnits(unit,values,language,options={}){
        const state=runtime(),current=state.normalizeValues(unit,values),units=[];
        if(options.saved?.saved===false || options.saved?.conflicts?.length)return units;
        const status=options.saved?state.statusFor(unit,options.saved):null;
        for(const field of unit.fields){
            const source=field.source,target=current[field.id];
            if(field.kind==='gender'||!source.trim()||state.audioOnly(source)||!target.trim()||target.trim()==='NONEXISTENT'&&!state.isNamedForm(field)
                || source.length>32768 || target.length>32768 || status?.fields[field.id]?.outdated)continue;
            if(state.diagnose(field,target).some(issue=>issue.level==='error'||issue.code==='clienttext-token-identity'||issue.code==='clienttext-unknown-syntax'))continue;
            const context=contextFor(unit,field),gameScope=options.game||'poe2';
            const normalized={source,target,language,gameScope,context,note:typeof unit.developerNotes==='string'?unit.developerNotes.slice(0,4096):'',
                provenance:{sourceHash:state.sourceHash(source),branchId:options.branchId||'default',jobId:options.jobId||'',filepath:unit.sheet,entryIndex:null,origin:options.origin||'save'}};
            try{
                const memory=Memory||root.TranslationMemory;
                const value=memory?.normalizeUnit?memory.normalizeUnit(normalized):normalized;
                value.id='ct-'+state.hash([gameScope,state.canonicalSource(source),context]);units.push(value);
            }catch(error){if(!(error instanceof TypeError))throw error;}
        }
        return units;
    }
    // No StatDescription decoding: literal backslash-n, real newlines and @
    // remain different characters through exact and fuzzy memory comparisons.
    const fold=value=>String(value).normalize('NFC').toLocaleLowerCase();
    const memorySnapshots=new WeakMap(),memorySources=new WeakMap();
    const memoryKind=context=>JSON.stringify([normalizeMode(context?.contentMode),String(context?.fieldKind||''),String(context?.form||'')]);
    function memoryGrams(points){
        const grams=new Map();
        for(let index=1;index<points.length;index++){
            const gram=points[index-1]+points[index];grams.set(gram,(grams.get(gram)||0)+1);
        }
        return grams;
    }
    function memorySnapshot(input){
        const rows=Array.isArray(input)?input:Array.from(input||[]),previous=memorySnapshots.get(rows);
        // Published libraries are immutable arrays. Recheck their source/type
        // fields so direct consumers that edit an array or unit stay correct.
        if(previous && previous.rows.length===rows.length && previous.rows.every((row,index)=>{
            const unit=rows[index];return row.unit===unit && row.source===unit.source && row.mode===unit.context?.contentMode
                && row.kind===unit.context?.fieldKind && row.form===unit.context?.form;
        }))return previous;
        const snapshot={rows:[],kinds:new Map()},sources=new Map();
        rows.forEach((unit,position)=>{
            snapshot.rows.push({unit,source:unit.source,mode:unit.context?.contentMode,kind:unit.context?.fieldKind,form:unit.context?.form});
            if(normalizeMode(unit.context?.contentMode)!=='clienttext')return;
            let prepared=memorySources.get(unit);
            if(!prepared || prepared.source!==unit.source){
                const source=runtime().canonicalSource(unit.source);
                let data=sources.get(source);
                if(!data){const points=Array.from(fold(source));data={source,points,grams:memoryGrams(points)};}
                prepared={source:unit.source,data};memorySources.set(unit,prepared);
            }
            const data=prepared.data;sources.set(data.source,data);
            const kind=memoryKind(unit.context);
            if(!snapshot.kinds.has(kind))snapshot.kinds.set(kind,new Map());
            const groups=snapshot.kinds.get(kind);
            if(!groups.has(data.source))groups.set(data.source,{...data,rows:[]});
            groups.get(data.source).rows.push({unit,position});
        });
        memorySnapshots.set(rows,snapshot);return snapshot;
    }
    function distance(left,right,maximum){
        if(Math.abs(left.length-right.length)>maximum)return maximum+1;
        let previous=Array.from({length:right.length+1},(_,index)=>index);
        for(let row=1;row<=left.length;row++){
            const next=Array(right.length+1).fill(maximum+1);next[0]=row;
            const start=Math.max(1,row-maximum),end=Math.min(right.length,row+maximum);let smallest=maximum+1;
            for(let column=start;column<=end;column++){
                next[column]=Math.min(previous[column]+1,next[column-1]+1,previous[column-1]+(left[row-1]===right[column-1]?0:1));
                smallest=Math.min(smallest,next[column]);
            }
            if(smallest>maximum)return maximum+1;previous=next;
        }
        return previous[right.length];
    }
    function findMemory(units,unit,field,options={}){
        if(!field||field.kind==='gender'||runtime().audioOnly(field.source))return[];
        const state=runtime(),context=contextFor(unit,field),source=state.canonicalSource(field.source),left=Array.from(fold(source));
        if(!source.trim())return[];
        const threshold=Math.max(0,Math.min(100,Number.isFinite(options.threshold)?options.threshold:75)),limit=Math.max(1,Math.min(100,options.limit||20));
        const groups=memorySnapshot(units).kinds.get(memoryKind(context));if(!groups)return[];
        const result=[],count=Math.floor(limit),named=state.isNamedForm(field),grams=memoryGrams(left);
        if(!count)return[];
        const compare=(a,b)=>b.score-a.score||String(a.unit.id).localeCompare(String(b.unit.id))||a.position-b.position;
        const eligible=candidate=>!candidate.deleted&&!candidate.suppressed&&candidate.enabled!==false&&candidate.target?.trim()
            && (candidate.target.trim()!=='NONEXISTENT'||named) && (!options.game||candidate.gameScope===options.game||candidate.gameScope==='all');
        const remember=(row,score,exact)=>{
            if(!eligible(row.unit))return;
            const sameContext=['sheet','recordId','fieldId'].every(name=>row.unit.context[name]===context[name]);
            const candidate={...row,score:exact&&sameContext?101:score,kind:exact?(sameContext?'context':'exact'):'fuzzy',sameContext};
            if(result.length>=count && compare(candidate,result[result.length-1])>=0)return;
            let start=0,end=result.length;
            while(start<end){const middle=(start+end)>>>1;if(compare(candidate,result[middle])<0)end=middle;else start=middle+1;}
            result.splice(start,0,candidate);if(result.length>count)result.pop();
        };
        const exact=groups.get(source);
        if(exact)for(const row of exact.rows)remember(row,100,true);
        for(const group of groups.values()){
            if(group===exact)continue;
            const cutoff=result.length>=count?Math.max(threshold,result[result.length-1].score):threshold;
            if(cutoff>99)break;
            const maximum=Math.max(left.length,group.points.length),radius=Math.floor(maximum*(100-cutoff)/100);
            if(Math.abs(left.length-group.points.length)>radius || !group.rows.some(row=>eligible(row.unit)))continue;
            let overlap=0;
            for(const [gram,value]of grams)overlap+=Math.min(value,group.grams.get(gram)||0);
            // One edit changes at most two adjacent character pairs. This is
            // an admissible bound, including sources with no shared bigram.
            if(Math.ceil((Math.max(left.length-1,group.points.length-1,0)-overlap)/2)>radius)continue;
            const edits=distance(left,group.points,radius),score=Math.min(99,maximum?Math.floor(100*(maximum-edits)/maximum):0);
            if(score<cutoff)continue;
            for(const row of group.rows)remember(row,score,false);
        }
        return result.map(({unit:candidate,score,kind,sameContext})=>({id:candidate.id,unit:candidate,source:candidate.source,target:candidate.target,
            score,kind,sameContext,warnings:state.diagnose(field,candidate.target),
            ...(Memory?.sourceDiff?{diff:Memory.sourceDiff(candidate.source,field.source)}:{})}));
    }
    const clienttext=Object.freeze({id:'clienttext',unitIdentity:unit=>unit.id,fields:unit=>unit.fields,
        values:(unit,saved)=>runtime().valuesFor(unit,saved),serialize:(unit,values)=>runtime().normalizeValues(unit,values),
        status:(unit,saved,options={})=>runtime().statusFor(unit,saved,options),
        history:(unit,saved)=>({unitId:unit.id,values:copy(runtime().valuesFor(unit,saved)),reviewed:copy(saved?.reviewed||{})}),
        diagnose:(unit,values,options={})=>unit.fields.flatMap(field=>runtime().englishIntentFor(field,options.saved,{game:options.game}) && !String(values[field.id] ?? '').trim()?[]:runtime().diagnose(field,values[field.id]).map(issue=>({...issue,fieldId:field.id}))),
        contextFor,contextReferenceIndex,cachedContextReferenceIndex,referenceMetadata,memoryUnits,findMemory,compatibleContext,
    });
    const statdescription=Object.freeze({id:'statdescription',unitIdentity:unit=>unit.filepath,
        fields:(unit,language)=> (unit.translations?.English||[]).map((source,index)=>({id:String(index),name:String(index+1),kind:'text',source,target:unit.translations?.[language]?.[index]||'',entryIndex:index})),
        values:(unit,saved,language)=>copy(saved?.translations||unit.translations?.[language]||[]),
        serialize:(unit,values)=>{if(!Array.isArray(values)||values.some(value=>typeof value!=='string'))throw new TypeError('StatDescription translations require an array of text entries.');return [...values];},
        history:(unit,saved,language)=>({filepath:unit.filepath,translations:copy(saved?.translations||unit.translations?.[language]||[])}),
        contextFor:(unit,field)=> (Memory||root.TranslationMemory).contextFor(unit,field.entryIndex??Number(field.id)),
        memoryUnits:(unit,values,language,options)=>(Memory||root.TranslationMemory).unitsFromDescription(unit,values,language,options),
        findMemory:(units,unit,field,options={})=>{
            const memory=Memory||root.TranslationMemory,game=options.game||'poe2';
            return memory.searchSync(memory.createIndex(units,{game}),{source:field.source,game,context:memory.contextFor(unit,field.entryIndex??Number(field.id))},options);
        },
        diagnose:(unit,values,options={})=>{
            const memory=Memory||root.TranslationMemory;
            return (unit.translations?.English||[]).flatMap((source,index)=>memory.validatePair(source,values[index],options.language).errors.map(issue=>({...issue,level:'error',fieldId:String(index)})));
        },
    });
    function forMode(mode){const id=normalizeMode(mode);if(id==='clienttext')return clienttext;if(id==='statdescription')return statdescription;throw new TypeError('Unknown content mode.');}
    return {forMode,clienttext,statdescription,normalizeMode};
});
