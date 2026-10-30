/* StatDescription syntax, shared by browser and API. Source text is never rewritten. */
(function(root,factory){
    const node=typeof module==='object'&&module.exports;
    const api=factory(node?require('./clientTextState.js'):root.ClientTextState,node?require('./translationDiagnostics.js'):root.TranslationDiagnostics);
    if(node)module.exports=api;else root.SDText=api;
})(typeof window!=='undefined'?window:globalThis,function(S,D){
    'use strict';
    const hash=value=>S.hash(value);
    const decode=text=>String(text??'').replace(/\\n/g,'\n');
    function protectedTokens(text){
        return S.tokenize(text).filter(t=>['keyword','variable','substitution','control'].includes(t.kind))
            .map(t=>t.kind+':'+(t.kind==='keyword'?t.identity:t.full)).sort();
    }
    function issues(source,target,{cell=false}={}){
        const result=[];source=String(source??'');target=String(target??'');
        const add=message=>result.push({level:'error',message});
        if(!target.trim()||!target.replace(/[\s@\u200b-\u200f\ufeff]/g,''))add('Complete this StatDescription entry before saving.');
        if(target.includes('\0'))add('NUL is not valid translation text.');
        const sources=decode(source).split('@'),targets=decode(target).split('@');
        if(cell&&target.includes('@')||sources.length!==targets.length)add('Preserve StatDescription table columns.');
        for(let i=0;i<Math.max(sources.length,targets.length);i++){
            const a=sources[i]||'',b=targets[i]||'';
            if(!!a.trim()!==!!b.trim())add('Preserve populated and empty source table columns.');
            if(JSON.stringify(protectedTokens(a))!==JSON.stringify(protectedTokens(b)))add('Preserve every variable, modifier, keyword ID and substitution in its table column.');
            if((a.match(/\n/g)||[]).length!==(b.match(/\n/g)||[]).length)add('Preserve the source line breaks.');
            const tags=text=>D.extractTextDecorationTags(text).map(t=>t.key).sort();
            if(JSON.stringify(tags(a))!==JSON.stringify(tags(b)))add('Match the exact source formatting tag names and counts.');
            for(const issue of D.analyze(b).diagnostics||[])
                if(issue.level==='error'||issue.code==='malformed-text-decoration-tag')result.push({...issue,level:'error'});
        }
        return result;
    }
    function styles(text,start,end){
        const result={b:null,i:null,u:null};
        for(const t of D.extractTextDecorationTags(text)){
            const style=({b:'b',bold:'b',i:'i',italic:'i',u:'u',underline:'u'})[t.key.toLowerCase()];
            if(!style)continue;
            const contentStart=t.openerEnd+2,contentEnd=t.end-2;
            if(start>=contentStart&&end<=contentEnd||start===t.start&&end===t.end)
                if(!result[style]||t.start>result[style].start)result[style]={...t,contentStart,contentEnd};
        }
        return result;
    }
    function format(text,source,start,end,style){
        if(!['b','i','u'].includes(style)||start<0||end<start||end>text.length)return null;
        const active=styles(text,start,end)[style];
        if(active)return {start:active.start,end:active.end,text:text.slice(active.contentStart,active.contentEnd),offset:0};
        const names={b:['b','bold'],i:['i','italic'],u:['u','underline']}[style];
        const sourceTags=D.extractTextDecorationTags(source),targetTags=D.extractTextDecorationTags(text);
        const tag=sourceTags.find(t=>names.includes(t.key.toLowerCase())&&targetTags.filter(x=>x.key===t.key).length<sourceTags.filter(x=>x.key===t.key).length)?.key||style;
        return {start,end,text:'<'+tag+'>{{'+text.slice(start,end)+'}}',offset:tag.length+4};
    }
    function context(file,index,column,dictionary=[],game='poe2',options={}){
        const english=file.translations?.English||[],source=column==null?decode(english[index]):decode(english[index]).split('@')[column]||'';
        const glossary=[];
        const normalized=value=>' '+String(value).normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}_]+/gu,' ').trim()+' ';
        for(const word of dictionary){
            if(word.disabled)continue;
            if(word.gameScope&&word.gameScope!=='all'&&word.gameScope!==game)continue;
            for(const definition of [word,...word.alts||[]]){
                if(!definition.find||!definition.replace)continue;
                if(normalized(source).includes(normalized(definition.find)))glossary.push({source:String(definition.find),translation:String(definition.replace)});
                if(glossary.length>=24)break;
            }
            if(glossary.length>=24)break;
        }
        const packet={identity:{contentMode:'statdescription',filepath:file.filepath,name:file.name||'',stats:[...file.stats||[]],entry:index,column},
            entry:{source:decode(english[index]),conditions:file.variables?.[index]||'',remarks:file.remarks?.[index]||''},
            glossary,syntax:{formatting:'<tag>{{text}}',variables:'Preserve exact placeholders and modifiers',tables:'@ separates fixed columns'}};
        packet.examples=[];
        const targets=options.committed||file.translations?.[options.language]||[];
        const siblings=english.map((text,i)=>({source:decode(text),translation:decode(targets[i]),conditions:file.variables?.[i]||'',index:i}))
            .filter(item=>item.index!==index&&item.translation.trim()&&!issues(item.source,item.translation).length)
            .sort((a,b)=>Math.abs(a.index-index)-Math.abs(b.index-index)||a.index-b.index);
        for(const item of siblings.slice(0,2))if(JSON.stringify(item).length<=3000)packet.examples.push(item);
        while(JSON.stringify(packet).length>14000&&packet.examples.length)packet.examples.pop();
        while(JSON.stringify(packet).length>14000&&packet.glossary.length)packet.glossary.pop();
        if(JSON.stringify(packet).length>14000){delete packet.entry.source;packet.omitted=['whole-entry-source'];}
        if(JSON.stringify(packet).length>14000){packet.identity.stats=[];packet.entry.remarks='';packet.omitted=['oversized-optional-context'];}
        return packet;
    }
    return {hash,decode,issues,styles,format,context,protectedTokens};
});
