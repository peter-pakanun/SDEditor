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

test('ordinary runtime copy stays neutral; explicit Admin model configuration and technical provenance may name models',()=>{
    const found=hits(join(root,'public'),file=>/\.(?:js|html|css)$/.test(file)&&!/\.min\.js$/.test(file));
    const legal=found.filter(hit=>hit.file==='policy.html'&&hit.text.includes('We do not sell Google user data, use it for advertising, or use it to train AI models.')
        &&hit.text.includes('Google API Services User Data Policy'));
    assert.equal(legal.length,1,'Preserve and explicitly account for the existing legal disclosure');
    const modelConfig=hit=>hit.file==='clientTextMtlSettingsUi.js'
        ||hit.file==='clientTextMtlState.js'&&hit.text.startsWith('const value=input.inferenceSettings,efforts=')
        ||hit.file==='clientTextMtlDebug.js'&&hit.text.startsWith('snapshot:')&&hit.text.includes('inferenceSettings:');
    assert.deepEqual(found.filter(hit=>!legal.includes(hit)&&!modelConfig(hit)),[],'Only the Admin model settings surface and bounded technical provenance may add model names');
    const controls=readFileSync(join(root,'public/clientTextComparisons.js'),'utf8');assert.match(controls,/mtlSettings\(\).*ctMtlSettingsAllowed/);
    const settings=readFileSync(join(root,'public/clientTextMtlSettingsUi.js'),'utf8');assert.match(settings,/isAdmin===true.*role==='admin'/);
});

test('remaining API literals are internal wire/configuration identifiers, not returned user-facing prose',()=>{
    const found=hits(join(root,'../SDEditor-API/src'),file=>/\.js$/.test(file)&&!/(?:^|[\\/])vendor[\\/]/.test(file));
    const internal=/\b(?:ISSUER|RESOURCE|SCOPES|MTL_MODEL|ENDPOINT)\s*=|\.scopes\.includes\(scope\)|\.issuer !==|provider:\s*(?:['"]openai-siwc|String\(provenance\.provider)|model:\s*String\(provenance\.model/;
    assert.ok(found.length>0,'Actual service identities remain intact');
    const modelConfig=hit=>hit.file==='mtl-inference-settings.js'&&!/new ApiError/.test(hit.text)
        ||hit.file==='mtl-provider.js'&&hit.text.includes("transport('https://api.openai.com/v1/models'")
        ||hit.file==='mtl-cloudflare-provider.js'&&(hit.text.startsWith('export const CLOUDFLARE_MTL_MODEL =')||hit.text.startsWith('const endpoint = configured ? `https://api.cloudflare.com/'))
        ||hit.file==='mtl-service.js'&&hit.text==="{ ...MTL_DEFAULT_SETTINGS, model: 'gpt-6-luna', effort: 'xhigh' }) === previous.requestHash) return previous.requestHash;";
    assert.deepEqual(found.filter(hit=>(!internal.test(hit.text)&&!modelConfig(hit))||/new ApiError/.test(hit.text)),[],
        'Every remaining branded API literal must be a technical identity, never an error message');
});

test('disabled consent points to the MTL data-sharing choice using neutral wording',()=>{
    const ui=readFileSync(join(root,'public/clientTextMtlUi.js'),'utf8');
    assert.match(ui,/Review and enable the updated MTL data-sharing and private review-retention choice in MTL settings first\./);
    assert.doesNotMatch(ui,/provider data-transmission choice/);
});
