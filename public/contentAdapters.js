/* Content-mode boundary: editor text and durable evidence keep their raw shape. */
(function(root,factory){
    const node=typeof module==='object'&&module.exports;
    const api=factory(root,node?require('./clientTextState.js'):root.ClientTextState,node?require('./translationMemory.js'):root.TranslationMemory);
    if(node)module.exports=api;else root.ContentAdapters=api;
})(typeof globalThis==='object'?globalThis:self,function(root,State,Memory){
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
    function contextCandidates(value){
        const spans=new Map(),add=(text,start)=>{
            const trimmed=text.trim();if(!trimmed)return;
            const offset=text.indexOf(trimmed),from=start+offset,to=from+trimmed.length;
            spans.set(from+':'+to,{value:trimmed,start:from,end:to});
        };
        add(value,0);
        for(const match of value.matchAll(/[^,\r\n]+/g))add(match[0],match.index);
        for(const match of value.matchAll(/[^\s,;()[\]{}<>"']+\/[^\s,;()[\]{}<>"']+/g))add(match[0],match.index);
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
            for(const value of Object.values(unit?.metadata||{}))if(typeof value==='string'&&value.trim())
                for(const candidate of contextCandidates(value))candidates.add(candidate.value);
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
    function referenceMetadata(unit,index){
        return Object.entries(unit?.metadata||{}).flatMap(([name,value])=>{
            if(typeof value!=='string'||!value.trim())return [];
            const parts=[];let offset=0,matched=false;
            if(index)for(const span of contextCandidates(value)){
                if(span.start<offset)continue;
                const candidates=index.get(span.value);if(!candidates?.length)continue;
                // Worksheet order supplies a generic label without knowing
                // target sheet/column names. Biography and other fields stay
                // in the tooltip; paragraphs are not promoted to inline labels.
                const label=candidates.length===1?candidates[0].fields[0]?.source:undefined;
                const resolved=structuredPath(span.value)&&typeof label==='string'&&label.length<=160&&!/[\r\n]/.test(label);
                if(span.start>offset)parts.push({text:value.slice(offset,span.start)});
                parts.push({text:resolved?label:span.value,tooltip:referenceTooltip(span.value,candidates,resolved)});
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
        const result=[];
        for(const candidate of units||[]){
            if(candidate.deleted||candidate.suppressed||candidate.enabled===false||!candidate.target?.trim()||candidate.target.trim()==='NONEXISTENT'&&!state.isNamedForm(field)
                ||!compatibleContext(candidate.context,context)||options.game&&candidate.gameScope!==options.game&&candidate.gameScope!=='all')continue;
            const before=state.canonicalSource(candidate.source),exact=before===source,right=Array.from(fold(before)),maximum=Math.max(left.length,right.length);
            if(!exact&&threshold===100)continue;
            const edits=exact?0:distance(left,right,Math.floor(maximum*(100-threshold)/100));
            const score=exact?100:Math.min(99,maximum?Math.floor(100*(maximum-edits)/maximum):0);
            if(score<threshold)continue;
            const sameContext=['sheet','recordId','fieldId'].every(name=>candidate.context[name]===context[name]);
            const warnings=state.diagnose(field,candidate.target);
            result.push({id:candidate.id,unit:candidate,source:candidate.source,target:candidate.target,score:exact&&sameContext?101:score,
                kind:exact?(sameContext?'context':'exact'):'fuzzy',sameContext,warnings,
                ...(Memory?.sourceDiff?{diff:Memory.sourceDiff(candidate.source,field.source)}:{})});
        }
        return result.sort((a,b)=>b.score-a.score||String(a.id).localeCompare(String(b.id))).slice(0,limit);
    }
    const clienttext=Object.freeze({id:'clienttext',unitIdentity:unit=>unit.id,fields:unit=>unit.fields,
        values:(unit,saved)=>runtime().valuesFor(unit,saved),serialize:(unit,values)=>runtime().normalizeValues(unit,values),
        status:(unit,saved)=>runtime().statusFor(unit,saved),
        history:(unit,saved)=>({unitId:unit.id,values:copy(runtime().valuesFor(unit,saved)),reviewed:copy(saved?.reviewed||{})}),
        diagnose:(unit,values)=>unit.fields.flatMap(field=>runtime().diagnose(field,values[field.id]).map(issue=>({...issue,fieldId:field.id}))),
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
