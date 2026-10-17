'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const root=join(__dirname,'..'),branded=/\bAI\b|OpenAI|ChatGPT|gpt-[a-z0-9]/i;
function hits(directory,filter){
    return readdirSync(directory,{recursive:true}).filter(filter).flatMap(file=>readFileSync(join(directory,file),'utf8').split(/\r?\n/)
        .flatMap((line,index)=>branded.test(line)?[{file:file.replace(/\\/g,'/'),line:index+1,text:line.trim()}]:[]));
}

test('all public runtime literals are unbranded except the preserved Google-data legal statement',()=>{
    const found=hits(join(root,'public'),file=>/\.(?:js|html|css)$/.test(file)&&!/\.min\.js$/.test(file));
    const legal=found.filter(hit=>hit.file==='policy.html'&&hit.text.includes('We do not sell Google user data, use it for advertising, or use it to train AI models.')
        &&hit.text.includes('Google API Services User Data Policy'));
    assert.equal(legal.length,1,'Preserve and explicitly account for the existing legal disclosure');
    assert.deepEqual(found.filter(hit=>!legal.includes(hit)),[],'No branded copy remains in runtime controls, Settings, privacy details, errors or fallbacks');
});

test('remaining API literals are internal wire/configuration identifiers, not returned user-facing prose',()=>{
    const found=hits(join(root,'../SDEditor-API/src'),file=>/\.js$/.test(file)&&!/(?:^|[\\/])vendor[\\/]/.test(file));
    const internal=/\b(?:ISSUER|RESOURCE|SCOPES|MTL_MODEL|ENDPOINT)\s*=|\.scopes\.includes\(scope\)|\.issuer !==|provider:\s*(?:['"]openai-siwc|String\(provenance\.provider)|model:\s*String\(provenance\.model/;
    assert.ok(found.length>0,'Actual service identities remain intact');
    assert.deepEqual(found.filter(hit=>!internal.test(hit.text)||/new ApiError/.test(hit.text)),[],
        'Every remaining branded API literal must be a technical identity, never an error message');
});

test('disabled consent points to the MTL data-sharing choice using neutral wording',()=>{
    const ui=readFileSync(join(root,'public/clientTextMtlUi.js'),'utf8');
    assert.match(ui,/Review and enable the MTL data-sharing choice in MTL settings first\./);
    assert.doesNotMatch(ui,/provider data-transmission choice/);
});
