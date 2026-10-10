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
            if(field.kind==='gender'||!source.trim()||state.audioOnly(source)||!target.trim()||target.trim()==='NONEXISTENT'
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
            if(candidate.deleted||candidate.suppressed||candidate.enabled===false||!candidate.target?.trim()||candidate.target.trim()==='NONEXISTENT'
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
        contextFor,memoryUnits,findMemory,compatibleContext,
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
