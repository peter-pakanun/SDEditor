/* Shared character guidance is authored data, separate from workbook text. */
(function(root,factory){
    const node=typeof module==='object'&&module.exports,api=factory(node?require('./clientTextMtlContext.js'):root.ClientTextMtlContext);
    if(node)module.exports=api;else root.ClientTextToneNotes=api;
})(typeof globalThis==='object'?globalThis:self,function(Context){
    'use strict';
    const MAX_CHARACTERS=300;
    const examples=Object.freeze({
        French:'Exemple : Parle sèchement et brièvement. Dit « je » et tutoie son interlocuteur, sans formules de politesse.',
        Thai:'ตัวอย่าง: บุคลิกแข็งกร้าว พูดสั้นห้วน แทนตัวว่า ‘ข้า’ เรียกคู่สนทนาว่า ‘แก’ ไม่ใช้คำลงท้ายสุภาพ',
        Portuguese:'Exemplo: Fala de forma ríspida e breve. Usa “eu” e trata a outra pessoa por “tu”, sem formalidades.',
        German:'Beispiel: Spricht schroff und knapp. Verwendet „ich“ und duzt das Gegenüber, ohne Höflichkeitsfloskeln.',
        Russian:'Пример: Говорит резко и коротко. Называет себя «я», обращается к собеседнику на «ты», без вежливых оборотов.',
        Spanish:'Ejemplo: Habla con rudeza y frases cortas. Usa «yo» y trata al interlocutor de «tú», sin fórmulas de cortesía.',
        'Traditional Chinese':'範例：個性強硬，說話簡短生硬。自稱「老子」，稱對方為「你」，不用敬語。',
        'Simplified Chinese':'示例：性格强硬，说话简短生硬。自称“老子”，称对方为“你”，不用敬语。',
        Korean:'예: 거칠고 짧게 말한다. 자신은 ‘나’, 상대는 ‘너’로 부르며 존댓말을 쓰지 않는다.',
        Japanese:'例：無愛想で短く話す。一人称は「俺」、相手は「お前」。敬語は使わない。',
        Polish:'Przykład: Mówi szorstko i krótko. Używa „ja”, zwraca się do rozmówcy na „ty”, bez uprzejmych formuł.',
        Turkish:'Örnek: Sert ve kısa konuşur. Kendisi için “ben”, karşısındaki için “sen” kullanır; resmî hitaplardan kaçınır.'
    });
    const lineNormalize=text=>String(text??'').replace(/\r\n?/g,'\n');
    const normalize=text=>{const value=lineNormalize(text);return value.trim()?value:'';};
    const count=text=>Array.from(lineNormalize(text)).length;
    const wellFormed=text=>typeof text.isWellFormed==='function'?text.isWellFormed():!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
    const validText=text=>typeof text==='string'&&count(text)<=MAX_CHARACTERS&&!/\p{Cc}/u.test(lineNormalize(text).replace(/[\t\n]/g,''))
        &&wellFormed(text);
    function identity(value){
        if(typeof value!=='string'||new TextEncoder().encode(value).length>1024||!/^(?:npc|character):.+$/u.test(value)
            ||/[\u0000-\u001f\u007f-\u009f]/u.test(value)||value.slice(value.indexOf(':')+1).trim()!==value.slice(value.indexOf(':')+1)
            ||!wellFormed(value))return null;
        const split=value.indexOf(':');return{key:value,kind:value.slice(0,split),path:value.slice(split+1)};
    }
    function scope(value){
        if(!value||!['poe1','poe2'].includes(value.game)||typeof value.branchId!=='string'||!value.branchId||typeof value.language!=='string'||!value.language)throw new TypeError('Tone-note scope is unavailable.');
        return{game:value.game,branchId:value.branchId,language:value.language};
    }
    function participants(host,unit=host.ctCurrentUnit){
        if(!unit)return[];
        const options={unit,units:host.ctUnits||[],scope:host.ctWorkspace?.scope||{},npcIndex:host._ctNpcIndex,convoIndex:host._ctConvoIndex},
            hints=host._ctToneRoleHints?.(options)||Context?.roleHints?.(options),entries=new Map();
        const add=(key,name,role)=>{const value=identity(key);if(!value)return;const previous=entries.get(key);
            entries.set(key,{...value,name:name||previous?.name||value.path.split('/').at(-1),roles:[...new Set([...(previous?.roles||[]),...(role?[role]:[])])]});};
        for(const actor of hints?.identities||[])add(actor.key,actor.name,
            hints.speaker?.identityKey===actor.key?'Speaker':hints.listener?.identityKey===actor.key?'Listener':'');
        if(/^NPCs(?:_Gender)?$/.test(unit.sheet))add('npc:'+unit.recordId,unit.fields?.find(field=>field.name==='Name')?.source);
        if(/^Characters(?:_Gender)?$/.test(unit.sheet))add('character:'+unit.recordId,unit.fields?.find(field=>field.name==='Name')?.source);
        // Exact canonical references remain useful when the related workbook
        // sheet is absent. Names and merged portrait art never create identities.
        for(const[name,raw]of Object.entries(unit.metadata||{}))if(/^(?:NPC|Character|Speaker|Speaking Character|Listener|Listening Character|Addressee)$/i.test(name))
            for(const path of String(raw).split(/[,\r\n]+/u).map(value=>value.trim()).filter(value=>value.startsWith('Metadata/'))){
                const known=new Set((host.ctUnits||[]).filter(value=>value.recordId===path).flatMap(value=>/^NPCs(?:_Gender)?$/.test(value.sheet)?['npc']:/^Characters(?:_Gender)?$/.test(value.sheet)?['character']:[]));
                if(known.size>1)continue;
                const kind=known.size?known.values().next().value:/^Character$/i.test(name)||path.startsWith('Metadata/Characters/')?'character':'npc';
                add(kind+':'+path);
            }
        return[...entries.values()].slice(0,16);
    }
    function roleKeys(host,unit=host.ctCurrentUnit){
        const options={unit,units:host.ctUnits||[],scope:host.ctWorkspace?.scope||{},npcIndex:host._ctNpcIndex,convoIndex:host._ctConvoIndex},
            hints=host._ctToneRoleHints?.(options)||Context?.roleHints?.(options);
        return[...new Set(['speaker','listener'].map(role=>hints?.[role]).filter(value=>['resolved','suggested'].includes(value?.status)&&identity(value.identityKey)).map(value=>value.identityKey))].slice(0,2);
    }
    return{MAX_CHARACTERS,examples,count,normalize,validText,identity,scope,participants,roleKeys,
        placeholder:language=>examples[language]||'Example: Gruff, terse speech. Uses “I” and informal forms of address.'};
});
