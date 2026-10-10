/* Controlled atomic IndexedDB fixture; native-browser coverage is separate. */
const CT = require('../public/clientTextStore.js');
function fixture() {
    const tables = new Map(CT.names.map(name => [name,new Map()])), operations = [], commits = [];
    let failStore = null;
    const clone = value => value === undefined ? undefined : structuredClone(value);
    const db = { objectStoreNames:{contains:name=>tables.has(name)},transaction(names,mode){
        const working = new Map(names.map(name=>[name,new Map([...tables.get(name)].map(([id,row])=>[id,clone(row)]))]));
        let pending=0,ended=false,timer;const writes=[];
        const tx={objectStore(name){
            if(!working.has(name))throw new Error('Store absent from transaction: '+name);
            const run=(method,arg,fn)=>{pending++;operations.push({name,mode,method,arg:clone(arg)});const req={};
                queueMicrotask(()=>{if(ended)return;try{if(failStore===name&&method==='put')throw new Error('Injected storage failure');req.result=fn();req.onsuccess?.();}
                    catch(error){req.error=tx.error=error;req.onerror?.();tx.abort();}pending--;finish();});return req;};
            return {get:id=>run('get',id,()=>clone(working.get(name).get(id))),
                put:row=>run('put',row.key,()=>{if(mode!=='readwrite')throw new Error('Readonly write');working.get(name).set(row.key,clone(row));writes.push({name,key:row.key});return row.key;}),
                delete:id=>run('delete',id,()=>{if(mode!=='readwrite')throw new Error('Readonly delete');working.get(name).delete(id);writes.push({name,key:id});}),
                index:index=>({getAll:value=>run('index.getAll',value,()=>[...working.get(name).values()].filter(row=>row[index==='by_scope'?'scope':index==='by_unit'?'unitKey':'accountId']===value).map(clone))})};
        },abort(){if(ended)return;ended=true;clearImmediate(timer);queueMicrotask(()=>tx.onabort?.());}};
        function finish(){if(ended||pending)return;clearImmediate(timer);timer=setImmediate(()=>{if(ended||pending)return;ended=true;
            if(mode==='readwrite'){for(const[name,rows]of working)tables.set(name,rows);commits.push(writes);}tx.oncomplete?.();});}
        finish();return tx;
    }};
    return {db,tables,operations,commits,store:CT.create({openDb:async()=>db,yield:async()=>{}}),fail(name){failStore=name;}};
}
const scope={accountId:'alice',game:'poe2',branchId:'default',versionId:'v1',groupId:'group1',language:'Thai'};
const fieldId=JSON.stringify(['Text',null]);
const unit=(source='Source',target='Thai',outdated=false)=>({id:JSON.stringify(['normal','ClientStrings','ID/1']),role:'normal',sheet:'ClientStrings',recordId:'ID/1',developerNotes:'Notes',metadata:{},
    fields:[{id:fieldId,name:'Text',kind:'text',source,target,required:true,originalMissing:!target,outdated,sourceCell:'B2',targetCell:'C2'}]});
const asset={role:'normal',name:'Thai.xlsx',hash:'a'.repeat(64),blob:new Blob(['original'])};
module.exports={fixture,scope,fieldId,unit,asset};
