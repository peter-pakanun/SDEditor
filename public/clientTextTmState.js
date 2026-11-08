/* Private TM review evidence; proposals are not workbook translations. */
(function(root,factory){
    const node=typeof module==='object'&&module.exports;
    const api=factory(node?require('./clientTextState.js'):root.ClientTextState,node?require('./translationMemory.js'):root.TranslationMemory);
    if(node)module.exports=api;else root.ClientTextTmState=api;
})(typeof globalThis==='object'?globalThis:self,function(S,TM){
    'use strict';
    const MAX_TEXT=32768,hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
    const changed=()=>Object.assign(new Error('This TM suggestion changed. Review the current suggestion again.'),{code:'TM_CANDIDATE_CHANGED'});
    const rawSourceHash=source=>S.hash(['sdeditor:tm-review:source:v1',String(source??'')]);
    const targetHash=text=>S.hash(['sdeditor:tm-review:target:v1',String(text??'')]);
    const eligible=field=>!!field&&['text','form'].includes(field.kind)&&!!S.canonicalSource(field.source).trim()
        &&!S.audioOnly(field.source)&&!/\bDNT\b/i.test(field.source);
    const choiceId=match=>'tm-choice-'+S.hash([match.tmId||match.id,TM.identityFor(match),match.target]);
    function normalizeMatch(input){
        if(!input||typeof input.id!=='string'||!input.id||!Number.isFinite(input.score)||input.score<0||input.score>101
            ||!['context','exact','fuzzy'].includes(input.kind))throw new TypeError('Invalid TM match evidence.');
        const realId=input.tmId??input.id;
        if(typeof realId!=='string'||!realId)throw new TypeError('Invalid original TM unit identity.');
        const unit=TM.normalizeUnit({...input,id:realId});
        if(unit.context?.contentMode!=='clienttext')throw new TypeError('A workbook suggestion requires ClientText TM evidence.');
        if(input.tmId!=null&&input.id!==choiceId({...unit,tmId:realId}))throw new TypeError('Invalid TM review choice identity.');
        return {...unit,...(input.tmId!=null?{id:input.id,tmId:realId}:{}),score:input.score,kind:input.kind};
    }
    function normalizeCandidate(input){
        if(!input||['id','unitId','fieldId','role','parserVersion'].some(name=>typeof input[name]!=='string'||!input[name]||input[name].length>4096)
            ||!['normal','gender'].includes(input.role)||!S.PARSER_VERSIONS.includes(input.parserVersion)
            ||!['assetHash','rawSourceHash','baseTargetHash'].every(name=>hex(input[name]))
            ||typeof input.source!=='string'||!input.source.trim()||input.source.length>MAX_TEXT||input.rawSourceHash!==rawSourceHash(input.source)
            ||!Array.isArray(input.matches)||!input.matches.length||input.matches.length>100
            ||!Number.isFinite(input.threshold)||input.threshold<0||input.threshold>100
            ||!['pending','accepted','dismissed'].includes(input.status)||!Number.isSafeInteger(input.revision)||input.revision<1
            ||!Number.isFinite(input.createdAt)||input.createdAt<0)throw new TypeError('Invalid TM review candidate.');
        const matches=input.matches.map(normalizeMatch),ids=new Set(),realIds=new Map();
        for(const match of matches){const id=match.tmId||match.id;realIds.set(id,(realIds.get(id)||0)+1);}
        for(let index=0;index<matches.length;index++)if(realIds.get(matches[index].tmId||matches[index].id)>1){
            const match=matches[index],tmId=match.tmId||match.id;matches[index]={...match,id:choiceId(match),tmId};
        }
        for(const match of matches){if(ids.has(match.id)||match.score<matches[0].score||match.score<input.threshold)throw new TypeError('Invalid or duplicate TM match choice.');ids.add(match.id);}
        if(matches.some(match=>match.score!==matches[0].score))throw new TypeError('TM review alternatives must share the highest score.');
        const value=Object.fromEntries(['id','unitId','fieldId','role','assetHash','parserVersion','source','rawSourceHash','baseTargetHash','threshold','status','revision','createdAt']
            .map(name=>[name,S.copy(input[name])]));
        value.matches=matches;
        if(input.overflow===true)value.overflow=true;
        for(const name of ['updatedAt','resolvedAt','acceptanceJobId','reviewedTextHash','restored'])if(Object.hasOwn(input,name))value[name]=S.copy(input[name]);
        return value;
    }
    function immutable(candidate){const value=normalizeCandidate(candidate);return S.hash(Object.fromEntries(Object.entries(value).filter(([name])=>!['status','revision','updatedAt','resolvedAt','acceptanceJobId','reviewedTextHash','restored'].includes(name))));}
    function applicable(candidate,field,descriptor){
        return !!candidate&&candidate.status==='pending'&&eligible(field)&&candidate.fieldId===field.id&&candidate.rawSourceHash===rawSourceHash(field.source)
            &&candidate.source===field.source&&!!descriptor&&candidate.role===descriptor.role&&candidate.assetHash===(descriptor.assetHash||descriptor.hash)
            &&candidate.parserVersion===descriptor.parserVersion&&(!descriptor.unitId||candidate.unitId===descriptor.unitId);
    }
    function validate(field,text){
        const issues=[];
        if(!eligible(field))issues.push({level:'error',code:'tm-ineligible',message:'This field cannot receive a TM suggestion.'});
        if(typeof text!=='string'||!text.trim())issues.push({level:'error',code:'tm-empty',message:'Review a nonblank translation before accepting it.'});
        else if(text.length>MAX_TEXT)issues.push({level:'error',code:'tm-too-long',message:'The TM review exceeds the field limit.'});
        else issues.push(...S.diagnose(field,text));
        const errors=issues.filter(issue=>issue.level==='error'||['clienttext-token-identity','clienttext-unknown-syntax'].includes(issue.code));
        return {valid:!errors.length,issues,errors,warnings:issues.filter(issue=>issue.level==='warning')};
    }
    function acceptance(candidate,text,selectedMatch){
        const value=normalizeCandidate(candidate),matchId=typeof selectedMatch==='string'?selectedMatch:selectedMatch?.id;
        if(value.status!=='pending'||value.restored||value.overflow||!value.matches.some(match=>match.id===matchId)||typeof text!=='string'||text.length>MAX_TEXT)throw changed();
        return {candidateId:value.id,candidateRevision:value.revision,fieldId:value.fieldId,rawSourceHash:value.rawSourceHash,
            matchId,reviewedTextHash:S.hash(text)};
    }
    function matchCurrent(match,liveUnits){
        if(!match)return false;const id=match.tmId||match.id,identity=TM.identityFor(match);
        return (liveUnits||[]).some(current=>(current.tmId||current.id)===id&&!current.deleted&&!current.suppressed&&current.enabled!==false
            &&current.revision===match.revision&&current.localRevision===match.localRevision&&current.source===match.source&&current.target===match.target
            &&TM.identityFor(current)===identity);
    }
    function validateAcceptances(candidates,unit,claims,values,descriptor,baseValues){
        if(!Array.isArray(claims)||claims.length>unit.fields.length)throw new TypeError('Invalid TM acceptances.');
        const used=new Set();
        return claims.map(claim=>{
            const candidate=candidates.find(value=>value.id===claim?.candidateId),field=unit.fields.find(value=>value.id===claim?.fieldId);
            if(used.has(claim?.fieldId)||!candidate||candidate.unitId!==unit.id||candidate.revision!==claim.candidateRevision
                ||!applicable(candidate,field,{...descriptor,role:unit.role,unitId:unit.id})
                ||candidate.baseTargetHash!==targetHash(baseValues?.[field.id]??'')||String(baseValues?.[field.id]??'').trim()
                ||claim.rawSourceHash!==candidate.rawSourceHash||claim.reviewedTextHash!==S.hash(values[field.id]))throw changed();
            used.add(field.id);return {...acceptance(candidate,values[field.id],claim.matchId),candidate:S.copy(candidate),unitId:unit.id};
        });
    }
    return {MAX_TEXT,rawSourceHash,targetHash,eligible,normalizeMatch,normalizeCandidate,immutable,applicable,validate,acceptance,matchCurrent,validateAcceptances,changed};
});
