'use strict';
const limits={userConcurrency:1,concurrency:2,userMinute:5,userDay:50,userWeek:250,subscriptionDay:100,subscriptionWeek:500};
function quota(userId='synthetic-admin',changes={}){
    const current={...limits,...changes.limits},bucket=(used,key,extra={})=>({used,limit:current[key],remaining:Math.max(0,current[key]-used),...extra}),
        reset={resetKind:'calendar',resetsAt:1800000000000};
    return{revision:0,limits:current,bounds:Object.fromEntries(Object.keys(limits).map(key=>[key,{min:1,max:key.includes('Concurrency')||key==='concurrency'?100:key==='userMinute'?10000:1000000}])),
        usage:{sampledAt:1799999999000,timezone:'Asia/Bangkok',weekStartsOn:'Monday',user:{id:userId,
            minute:bucket(2,'userMinute',{resetKind:'rolling',resetsAt:1800000000000,fullyResetsAt:1800000010000}),
            day:bucket(12,'userDay',reset),week:bucket(30,'userWeek',reset),concurrency:bucket(1,'userConcurrency')},
            shared:{subscriptionId:'synthetic-connection',day:bucket(40,'subscriptionDay',reset),week:bucket(90,'subscriptionWeek',reset)},service:{concurrency:bucket(2,'concurrency')}},
        ...changes,limits:current};
}
module.exports={quota,limits};
