/* Pure cross-repository validation: synthetic context only; no server or inference. */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {existsSync} = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const Context = require('../public/clientTextMtlContext.js');
const S = require('../public/clientTextState.js');
const validationPath = path.resolve(__dirname,'../../SDEditor-API/src/mtl-validation.js');
const options = {skip: !existsSync(validationPath) && 'Requires the sibling SDEditor-API checkout.'};
const api = () => import(pathToFileURL(validationPath).href);
const field = (name,source,target) => ({id:JSON.stringify([name,null]),name,kind:'text',source,target,sourceCell:'B2',targetCell:'C2'});
const unit = (sheet,recordId,fields) => S.normalizeUnit({role:'normal',sheet,recordId,fields});
function request(selected,context,validation) {
    const source=selected.fields[0];
    return {requestId:'synthetic-keyword-context',unitId:selected.id,fieldId:source.id,role:selected.role,
        assetHash:'a'.repeat(64),parserVersion:S.PARSER_VERSION,source:source.source,sourceHash:S.sourceHash(source.source),
        rawSourceHash:validation.rawSourceHash(source.source),baseTargetHash:S.hash(source.target),baseRevision:0,
        clientFacts:S.clientFacts(selected),context,consentVersion:'mtl-v1'};
}
function count(value) {
    return 1 + (Array.isArray(value)?value.reduce((sum,item)=>sum+count(item),0)
        :value && typeof value==='object'?Object.values(value).reduce((sum,item)=>sum+count(item),0):0);
}
function bounds(context,body) {
    assert.ok(JSON.stringify(context).length<=Context.LIMITS.context);
    assert.ok(Buffer.byteLength(JSON.stringify(context))<=Context.LIMITS.contextBytes);
    assert.ok(count(context)<=Context.LIMITS.contextEntries);
    assert.ok(Buffer.byteLength(JSON.stringify(body))<=Context.LIMITS.bytes);
}

test('API accepts generated keyword English/translation pairs with scoped Saved and original provenance',options,async()=>{
    const validation=await api(),selected=unit('ClientStrings','Selected',[field('Text','Use [Spark|visible label].','Existing selected translation')]),
        popup=unit('KeywordPopups','Spark',[field('Info Title','Synthetic title English','Original title'),
            field('Info Content','Synthetic content English','Original content')]),
        saved={[popup.id]:{saved:true,values:{[popup.fields[0].id]:'Authored title'}}},
        context=Context.build({unit:selected,field:selected.fields[0],units:[selected,popup],saved}),body=request(selected,context,validation);
    for(const local of [false,true]) {
        const input=local?{...body,language:'Thai',game:'poe2',branchId:'default'}:body,accepted=validation.mtlRequestInput(input,{local});
        assert.deepEqual(accepted.context,context);
        assert.deepEqual(accepted.context.keywords[0].fields.map(item=>[item.name,item.translation,item.translationOrigin]),
            [['Info Title','Authored title','saved'],['Info Content','Original content','original-workbook']]);
        assert.deepEqual(accepted.context.keywords[0].fields.map(item=>item.source),popup.fields.map(item=>item.source));
        bounds(context,input);
    }
});

test('API accepts generated keyword contexts under text, UTF-8 and structural pressure without truncating retained fields',options,async()=>{
    const validation=await api();
    for(const {records,fields,target} of [{records:3,fields:2,target:'\u0e01'.repeat(4000)}, {records:45,fields:8,target:'\u0e01'}]) {
        const selected=unit('ClientStrings','Selected',[field('Text',Array.from({length:records},(_,i)=>'[K'+i+'|label]').join(' '),'Existing selected')]),
            popups=Array.from({length:records},(_,i)=>unit('KeywordPopups','K'+i,Array.from({length:fields},(_,j)=>field('Field '+j,'English '+i+':'+j,target)))),
            context=Context.build({unit:selected,field:selected.fields[0],units:[selected,...popups]}),body=request(selected,context,validation),
            accepted=validation.mtlRequestInput(body);
        assert.ok(accepted.context.keywords.length>0);bounds(context,body);
        for(const record of accepted.context.keywords) {
            const original=popups.find(item=>item.id===record.unitId);
            assert.deepEqual(record.fields.map(item=>item.source),original.fields.map(item=>item.source));
            for(const projected of record.fields)if(Object.hasOwn(projected,'translation')) {
                assert.equal(projected.translation,target);assert.equal(projected.translationOrigin,'original-workbook');
            }
        }
    }
});

test('oversized keyword translations leave bounded English context and API context limits remain enforced',options,async()=>{
    const validation=await api(),selected=unit('ClientStrings','Selected',[field('Text','Use [Spark|spark].','Existing selected')]),
        popup=unit('KeywordPopups','Spark',[field('Info Title','Title English','Small title'),field('Info Content','Content English','Original content')]),
        saved={[popup.id]:{saved:true,values:{[popup.fields[1].id]:'\u0e01'.repeat(20000)}}},
        context=Context.build({unit:selected,field:selected.fields[0],units:[selected,popup],saved,contextLimit:1800}),body=request(selected,context,validation);
    validation.mtlRequestInput(body);bounds(context,body);
    assert.ok(JSON.stringify(context).length<=1800);
    assert.equal(context.keywords[0].fields[0].translation,'Small title');
    assert.equal(context.keywords[0].fields[1].source,'Content English');
    assert.equal(context.keywords[0].fields[1].translation,undefined);
    assert.throws(()=>validation.mtlRequestInput({...body,context:{...context,overflow:'x'.repeat(16001)}}),/16000/);
    assert.throws(()=>validation.mtlRequestInput({...body,context:{...context,overflow:'\u0e01'.repeat(17000)}}),/48 KiB/);
    assert.throws(()=>validation.mtlRequestInput({...body,context:{...context,overflow:Array.from({length:1501},()=>true)}}),/too many entries/);
});
