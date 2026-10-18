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

test('client-parsed blank class cells share raw English but contribute one context field and preserve API facts',options,async()=>{
    const validation=await api(),JSZip=require('../../SDEditor-API/node_modules/jszip'),Codec=require('../public/clientTextCodec.js'),zip=new JSZip(),
        ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',cell=(ref,text)=>'<c r="'+ref+'" t="inlineStr"><is><t>'+text+'</t></is></c>',
        headers=['ID','Text','Translation',...S.CLASS_FORMS],row=(index,id)=>'<row r="'+index+'">'+cell('A'+index,id)
            +cell('B'+index,'Synthetic dialogue')+cell('C'+index,'Approved dialogue')+'</row>';
    zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
    zip.file('xl/workbook.xml','<workbook xmlns="'+ns+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="NPCTalkDialogueTextAudio" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml','<worksheet xmlns="'+ns+'"><sheetData><row r="1">'+headers.map((name,i)=>cell(String.fromCharCode(65+i)+'1',name)).join('')+'</row>'+row(2,'Synthetic_A')+row(3,'Synthetic_B')+'</sheetData></worksheet>');
    const parsed=await Codec.parseWorkbook(await zip.generateAsync({type:'uint8array'}),{filename:'Thai.xlsx',role:'normal',language:'Thai'}),
        neighbor=parsed.units[0],selected=parsed.units[1],before=JSON.stringify(parsed.units),
        convoIndex={memberships:new Map(parsed.units.map(value=>[value.id,{familyKey:'Synthetic'}]))};
    assert.equal(neighbor.fields.length,13);
    assert.ok(neighbor.fields.every(value=>value.source==='Synthetic dialogue' && value.sourceCell==='B2'));
    assert.ok(neighbor.fields.slice(1).every(value=>value.target==='' && value.required===false));
    const context=Context.build({unit:selected,field:selected.fields[0],units:parsed.units,convoIndex}),body=request(selected,context,validation);
    assert.equal(context.surrounding.entries[0].fields.length,1);assert.equal(context.surrounding.omitted.fieldLimit,0);
    assert.equal(body.clientFacts.fields.length,13);validation.mtlRequestInput(body);bounds(context,body);
    assert.equal(JSON.stringify(parsed.units),before);
});

test('API accepts priority keyword translations and durable omission counts under a large nearby workload',options,async()=>{
    const validation=await api(),selected=unit('ClientStrings','Selected',[{...field('Text','Use [SyntheticKeyword|label].','Existing selected'),sourceCell:'B1003',targetCell:'C1003'}]),
        popup=unit('KeywordPopups','SyntheticKeyword',[field('Info Title','Synthetic title','Original title'),field('Info Content','Synthetic content','Original content')]),
        neighbors=Array.from({length:1000},(_,i)=>unit('ClientStrings','Neighbor'+i,[{...field('Text','Nearby English '.repeat(12),'Nearby approved '.repeat(8)),sourceCell:'B'+(i+3),targetCell:'C'+(i+3)}])),
        saved={[popup.id]:{saved:true,values:{[popup.fields[0].id]:'Saved priority title'}}},
        context=Context.build({unit:selected,field:selected.fields[0],units:[...neighbors,selected,popup],saved}),body=request(selected,context,validation);
    const accepted=validation.mtlRequestInput(body);bounds(context,body);
    assert.equal(accepted.context.keywordLookup.matched,1);assert.equal(accepted.context.omitted.keywords,0);
    assert.equal(accepted.context.omitted.keywordTranslations,0);assert.equal(accepted.context.keywords[0].fields[0].translation,'Saved priority title');
    assert.equal(accepted.context.surrounding.omitted.irrelevant,1000);assert.equal(accepted.context.surrounding.selectedEntries,0);
    assert.equal(accepted.context.evidenceRules.length,2);
});

test('API accepts optional role hints and sourced profiles with unchanged context and request limits',options,async()=>{
    const validation=await api(),a='Metadata/Characters/Int/IntFour',b='Metadata/Characters/Str/StrFour',
        selected=unit('NPCTalkDialogueTextAudio','SyntheticSelected',[field('Text','Use [Spark|spark].','Approved selected')]),
        hero=unit('Characters',a,[field('Name','Synthetic Mage','Approved name'),field('Description','A'.repeat(1800),'\u0e01'.repeat(1400))]),
        listener=unit('Characters',b,[field('Name','Synthetic Warrior','Approved name'),field('Description','B'.repeat(1600),'\u0e02'.repeat(1500))]),
        keyword=unit('KeywordPopups','Spark',[field('Info Content','Synthetic keyword source.','Approved keyword.')]);
    selected.metadata={Speaker:a,Listener:b};
    const context=Context.build({unit:selected,field:selected.fields[0],units:[selected,hero,listener,keyword],scope:{game:'poe2'}}),body=request(selected,context,validation);
    assert.equal(context.roleHints.speaker.confidence,'explicit'); assert.equal(context.roleHints.listener.confidence,'explicit');
    assert.equal(context.toneContext.characters,1200); assert.equal(context.toneContext.profiles.length,2);
    assert.deepEqual(context.toneContext.profiles.map(item=>item.roles),[['speaker'],['listener']]);
    assert.equal(context.keywords[0].fields[0].translation,'Approved keyword.');
    for(const local of [false,true]) {
        const input=local?{...body,language:'Thai',game:'poe2',branchId:'default'}:body;
        assert.deepEqual(validation.mtlRequestInput(input,{local}).context,context); bounds(context,input);
    }
    const legacy=structuredClone(context); delete legacy.roleHints; delete legacy.toneContext;
    for(const name of ['roleHints','toneProfiles','voiceExamples','toneUnavailable'])delete legacy.omitted[name];
    assert.deepEqual(validation.mtlRequestInput({...body,context:legacy}).context,legacy);
});

test('API preserves bounded role/tone omission provenance under a large surrounding workload',options,async()=>{
    const validation=await api(),path='Metadata/Characters/Int/IntFour',
        selected=unit('NPCTalkDialogueTextAudio','Selected',[field('Text','Synthetic dialogue.','Approved selected')]),
        actor=unit('Characters',path,[field('Name','Synthetic Mage','Approved name'),field('Description','A'.repeat(2000),'\u0e01'.repeat(3000))]),
        rows=Array.from({length:70},(_,i)=>{
            const value=unit(selected.sheet,'Neighbor'+i,[field('Text','Nearby synthetic '+i+' '+'x'.repeat(1000),'Approved neighbor '+i)]);
            value.fields[0].sourceCell='B'+(i+10);value.fields[0].targetCell='C'+(i+10);return value;
        });
    selected.metadata={Speaker:path};
    const convoIndex={memberships:new Map([selected,...rows].map(value=>[value.id,{familyKey:'Synthetic'}]))},
        context=Context.build({unit:selected,field:selected.fields[0],units:[selected,actor,...rows],convoIndex,scope:{game:'poe2'}}),body=request(selected,context,validation);
    assert.equal(context.omitted.roleHints,0); assert.equal(context.omitted.toneProfiles,0);
    assert.equal(context.toneContext.profiles[0].sourceTruncated,true); assert.equal(context.toneContext.profiles[0].translationTruncated,true);
    assert.equal(context.surrounding.selectedEntries,2); assert.equal(context.surrounding.omitted.entryLimit,68);
    assert.deepEqual(validation.mtlRequestInput(body).context,context);bounds(context,body);
});

test('API retains distinct same-name NPC identities without importing another path as speaker voice',options,async()=>{
    const validation=await api(),N=require('../public/clientTextNpcIndex.js'),a='Metadata/NPC/Synthetic/FirstGuard',b='Metadata/NPC/Synthetic/SecondGuard',
        selected=unit('NPCTalkDialogueTextAudio','Selected',[field('Text','Synthetic selected dialogue.','Approved selected')]),
        first=unit('NPCs',a,[field('Name','Synthetic Guard','Approved name')]),second=unit('NPCs',b,[field('Name','Synthetic Guard','Approved name')]),
        own=unit(selected.sheet,'Own',[field('Text','Verified first guard voice.','Approved first guard voice.')]),
        other=unit(selected.sheet,'Other',[field('Text','WRONG SECOND GUARD VOICE','Approved second guard voice.')]);
    selected.metadata={Speaker:a,Listener:b};own.metadata={Speaker:a};other.metadata={Speaker:b};
    const units=[selected,first,second,own,other],npcIndex=await N.buildNpcIndex(units,{yield:async()=>{}}),
        context=Context.build({unit:selected,field:selected.fields[0],units,npcIndex,scope:{game:'poe2'}}),body=request(selected,context,validation);
    assert.equal(context.roleHints.speaker.identityKey,'npc:'+a);assert.equal(context.roleHints.listener.identityKey,'npc:'+b);
    assert.deepEqual(context.toneContext.voiceExamples.map(value=>value.provenance.recordId),['Own']);
    assert.deepEqual(validation.mtlRequestInput(body).context,context);bounds(context,body);
    selected.metadata={Speaker:a,'Speaking Character':b};
    const conflict=Context.build({unit:selected,field:selected.fields[0],units,npcIndex,scope:{game:'poe2'}});
    assert.equal(conflict.roleHints.speaker.status,'conflict');assert.equal(conflict.toneContext.voiceExamples.length,0);
    validation.mtlRequestInput(request(selected,conflict,validation));
});

test('API accepts canonical scoped shared tone notes without changing role uncertainty or request budgets',options,async()=>{
    const validation=await api(),path='Metadata/Characters/Int/IntFour',listener='Metadata/Characters/Str/StrFour',
        selected=unit('NPCTalkDialogueTextAudio','SyntheticSelected',[field('Text','Use [Spark|spark].','Approved selected')]),
        popup=unit('KeywordPopups','Spark',[field('Info Content','Synthetic keyword source.','Approved keyword translation.')]),
        scope={accountId:'synthetic-account',game:'poe2',branchId:'default',language:'Thai'},
        toneNotes={status:'ready',accountId:scope.accountId,scope:{game:'poe2',branchId:'default',language:'Thai'},entries:[
            {identityKey:'character:'+path,revision:3,text:'😀'.repeat(300)},
            {identityKey:'character:'+listener,revision:7,text:'\u0e01'.repeat(300)}]};
    selected.metadata={Speaker:path,Listener:listener};
    const context=Context.build({unit:selected,field:selected.fields[0],units:[selected,popup],scope,toneNotes}),body=request(selected,context,validation);
    assert.deepEqual(context.sharedToneNotes,{version:'clienttext-shared-tone-notes-v1',scope:toneNotes.scope,
        entries:toneNotes.entries.map((value,i)=>({...value,roles:[i?'listener':'speaker']}))});
    assert.equal(context.toneContext.styleNoteSelection.characters,600);assert.equal(context.omitted.styleNotes,0);
    assert.equal(context.keywords[0].fields[0].translation,'Approved keyword translation.');
    for(const local of [false,true]) {
        const input=local?{...body,language:'Thai',game:'poe2',branchId:'default'}:body;
        assert.deepEqual(validation.mtlRequestInput(input,{local}).context,context);bounds(context,input);
    }
    selected.metadata={Character:path};
    const tentative=Context.build({unit:selected,field:selected.fields[0],units:[selected,popup],scope,toneNotes});
    assert.equal(tentative.roleHints.speaker.confidence,'heuristic');assert.equal(tentative.sharedToneNotes.entries.length,1);
    assert.deepEqual(tentative.sharedToneNotes.entries[0].roles,['speaker']);
    validation.mtlRequestInput(request(selected,tentative,validation));
});

test('API accepts explicit exact catalog NPC role notes from a partial workbook without invented source records',options,async()=>{
    const validation=await api(),path='Metadata/NPC/Four_Act4/HoodedMentorKingsmarchIntro',
        selected=unit('NPCTalkDialogueTextAudio','SyntheticPartial',[field('Text','Synthetic dialogue.','Approved selected')]),
        scope={accountId:'synthetic-account',game:'poe2',branchId:'default',language:'Thai'},
        toneNotes={status:'ready',accountId:scope.accountId,scope:{game:'poe2',branchId:'default',language:'Thai'},
            entries:[{identityKey:'npc:'+path,revision:2,text:'Saved synthetic speaker style.'}]};
    selected.metadata={Speaker:path};
    const context=Context.build({unit:selected,field:selected.fields[0],units:[selected],scope,toneNotes}),body=request(selected,context,validation);
    assert.equal(context.roleHints.speaker.status,'resolved');assert.equal(context.roleHints.speaker.identityKey,'npc:'+path);
    assert.deepEqual(context.sharedToneNotes.entries,[{...toneNotes.entries[0],roles:['speaker']}]);
    assert.equal(context.roleHints.identities[0].name,undefined);assert.equal(context.roleHints.identities[0].identityEvidence,'reviewed-catalog-exact-path');
    assert.deepEqual(context.references,[]);assert.deepEqual(context.toneContext.profiles,[]);
    for(const local of [false,true]) {
        const input=local?{...body,language:'Thai',game:'poe2',branchId:'default'}:body;
        assert.deepEqual(validation.mtlRequestInput(input,{local}).context,context);bounds(context,input);
    }
});
