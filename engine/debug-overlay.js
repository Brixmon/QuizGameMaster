(function(){
  "use strict";

  // Embedded transition frames must never create their own debug bug/panel.
  // The parent game owns the single global debug UI.
  try{
    var __qgmParams=new URLSearchParams(location.search);
    if(window.parent!==window&&__qgmParams.get("embed")==="1")return;
  }catch(__qgmEmbedErr){}

  var VERSION="1.0.46";
  var BRIDGE_HOST="quizgamemaster-bridge.vip-krasts.workers.dev";
  var LIMITS={workerRequests:100000,kvReads:100000,kvWrites:1000,kvDeletes:1000,kvLists:1000};

  function utcDay(){
    var d=new Date();
    return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0")+"-"+String(d.getUTCDate()).padStart(2,"0");
  }
  function key(){return "qgm_debug_usage_"+utcDay()}
  function blank(){
    return {
      day:utcDay(),workerRequests:0,kvReads:0,kvWrites:0,kvDeletes:0,kvLists:0,
      tokenRequests:0,profileRequests:0,analyticsPosts:0,otherBridgeRequests:0,
      http429:0,http1027:0,networkErrors:0,lastUrl:"—",lastMethod:"—",lastStatus:"—",
      firstAt:"",lastAt:"—",last429:"",last429Body:"",lastError:"",endpointCounts:{},recent:[]
    };
  }
  function load(){
    try{
      var x=JSON.parse(localStorage.getItem(key())||"null");
      if(!x||x.day!==utcDay())return blank();
      return Object.assign(blank(),x);
    }catch(e){return blank()}
  }
  var usage=load();
  if(!usage.endpointCounts||typeof usage.endpointCounts!=="object")usage.endpointCounts={};
  if(!Array.isArray(usage.recent))usage.recent=[];

  function pushRecent(method,u,status){
    usage.recent.unshift({at:new Date().toISOString(),method:String(method||"—"),url:endpointLabel(u),status:String(status==null?"—":status)});
    usage.recent=usage.recent.slice(0,12);
  }
  function ratePerMinute(){
    if(!usage.firstAt)return 0;
    var ms=Date.now()-Date.parse(usage.firstAt);
    if(!Number.isFinite(ms)||ms<=0)return 0;
    return Math.round((usage.workerRequests/(ms/60000))*10)/10;
  }
  function topEndpoints(){
    return Object.entries(usage.endpointCounts||{}).sort(function(a,b){return b[1]-a[1]}).slice(0,6);
  }

  function save(){
    try{localStorage.setItem(key(),JSON.stringify(usage))}catch(e){}
    render();
  }
  function safeUrl(input){
    try{
      if(input instanceof Request)return new URL(input.url,location.href);
      return new URL(String(input),location.href);
    }catch(e){return null}
  }
  function endpointLabel(u){
    if(!u)return "unknown";
    return u.pathname+(u.search||"");
  }
  function classify(method,u){
    var p=u.pathname;
    usage.workerRequests++;
    if(!usage.firstAt)usage.firstAt=new Date().toISOString();
    var ep=method+" "+endpointLabel(u);
    usage.endpointCounts[ep]=(Number(usage.endpointCounts[ep])||0)+1;
    if(p==="/game/state"&&method==="GET")usage.kvReads++;
    else if(p==="/game/state"&&method==="PUT")usage.kvWrites++;
    else if(method==="DELETE"&&/kv/i.test(p))usage.kvDeletes++;
    else if(/\/list(?:\/|$)/i.test(p)&&method==="GET")usage.kvLists++;
    else if(p==="/token")usage.tokenRequests++;
    else if(p==="/profile")usage.profileRequests++;
    else if(p==="/analytics/batch")usage.analyticsPosts++;
    else usage.otherBridgeRequests++;
  }
  function pct(v,max){return max?Math.min(100,Math.round((Number(v)||0)*1000/max)/10):0}
  function severity(v,max){
    var p=pct(v,max);
    return p>=90?"danger":p>=70?"warn":"ok";
  }
  function esc(x){
    return String(x==null?"":x).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]});
  }
  function metric(label,k,limit){
    var v=Number(usage[k])||0,p=pct(v,limit),s=severity(v,limit);
    return '<div class="qgmdbg-metric '+s+'"><div><span>'+esc(label)+'</span><b>'+v.toLocaleString()+' / '+limit.toLocaleString()+'</b></div><div class="qgmdbg-bar"><i style="width:'+p+'%"></i></div><small>'+p+'%</small></div>';
  }

  var originalFetch=window.fetch;
  if(typeof originalFetch==="function"&&!window.__QGM_DEBUG_FETCH_WRAPPED__){
    window.__QGM_DEBUG_FETCH_WRAPPED__=true;
    window.fetch=function(input,init){
      var u=safeUrl(input),method=String((init&&init.method)||(input instanceof Request&&input.method)||"GET").toUpperCase();
      var bridge=u&&u.hostname===BRIDGE_HOST;
      if(bridge){
        classify(method,u);
        usage.lastUrl=endpointLabel(u);
        usage.lastMethod=method;
        usage.lastAt=new Date().toISOString();
        save();
      }
      return originalFetch.apply(this,arguments).then(function(r){
        if(bridge){
          usage.lastStatus=String(r.status);
          pushRecent(method,u,r.status);
          if(r.status===429){
            usage.http429++;
            usage.last429=method+" "+endpointLabel(u)+" · HTTP 429 · "+new Date().toISOString();
            try{
              r.clone().text().then(function(t){
                usage.last429Body=String(t||"").replace(/\s+/g," ").slice(0,500);
                if(/1027/.test(t||""))usage.http1027++;
                save();
              }).catch(function(){});
            }catch(e){}
          }
          save();
        }
        return r;
      }).catch(function(err){
        if(bridge){
          usage.networkErrors++;
          usage.lastError=method+" "+endpointLabel(u)+" · "+String(err&&err.message||err);
          usage.lastStatus="NETWORK ERROR";
          pushRecent(method,u,"NETWORK ERROR");
          save();
        }
        throw err;
      });
    };
  }

  function injectStyle(){
    if(document.getElementById("qgm-debug-style"))return;
    var s=document.createElement("style");
    s.id="qgm-debug-style";
    s.textContent=
      ".qgmdbg-toggle{position:fixed;z-index:2147483000;top:54px;right:12px;width:42px;height:42px;border-radius:50%;border:1px solid #ffd45eaa;background:#07131ef2;color:#ffd45e;display:grid;place-items:center;font-size:20px;box-shadow:0 4px 18px #000b,0 0 12px #ffd45e33;cursor:pointer;line-height:1}"+
      ".qgmdbg-toggle.on{background:#6d5318f2;box-shadow:0 4px 18px #000b,0 0 18px #ffd45e77}"+
      ".qgmdbg-panel{position:fixed;z-index:2147482999;top:102px;right:12px;width:min(430px,calc(100vw - 24px));max-height:78vh;overflow:auto;display:none;padding:12px;border:1px solid #ffd45e88;border-radius:14px;background:#020a12f5;color:#ddecf5;box-shadow:0 8px 28px #000d;font-family:Arial,sans-serif;text-align:left;line-height:1.25}"+
      ".qgmdbg-panel.show{display:block}.qgmdbg-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}.qgmdbg-head b{font-size:14px;color:#ffd45e;letter-spacing:.06em}.qgmdbg-head span{font-size:10px;color:#8ea5b5}.qgmdbg-close{border:1px solid #ffffff22;background:#ffffff0b;color:#fff;border-radius:50%;width:26px;height:26px;font-size:17px;cursor:pointer}"+
      ".qgmdbg-note{padding:8px;border-radius:9px;background:#0b1a25;color:#91aabc;font-size:10px;margin-bottom:9px}.qgmdbg-note strong{color:#ddecf5}"+
      ".qgmdbg-metric{padding:7px 0;border-top:1px solid #ffffff12}.qgmdbg-metric>div:first-child{display:flex;justify-content:space-between;gap:8px;font-size:10px}.qgmdbg-metric span{color:#9fb6c5;font-weight:700}.qgmdbg-metric b{font-size:11px;color:#fff}.qgmdbg-bar{height:5px;margin-top:5px;border-radius:10px;background:#ffffff10;overflow:hidden}.qgmdbg-bar i{display:block;height:100%;background:#65e7a1}.qgmdbg-metric.warn .qgmdbg-bar i{background:#ffd45e}.qgmdbg-metric.danger .qgmdbg-bar i{background:#ff6f74}.qgmdbg-metric small{display:block;text-align:right;margin-top:2px;font-size:9px;color:#7893a5}"+
      ".qgmdbg-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:9px}.qgmdbg-cell{padding:7px;border:1px solid #ffffff12;border-radius:8px;background:#07131d}.qgmdbg-cell span{display:block;color:#7893a5;font-size:9px;font-weight:700}.qgmdbg-cell b{display:block;margin-top:3px;color:#eef8ff;font-size:11px;word-break:break-word}.qgmdbg-cell.wide{grid-column:1/-1}"+
      ".qgmdbg-alert{margin-top:8px;padding:8px;border:1px solid #ff6f7444;border-radius:8px;background:#3a1117aa;color:#ffb6ba;font-size:10px;white-space:pre-wrap;word-break:break-word}.qgmdbg-alert:empty{display:none}"+
      ".qgmdbg-section{margin-top:10px;padding-top:8px;border-top:1px solid #ffd45e2a;color:#ffd45e;font-size:10px;font-weight:900;letter-spacing:.08em}"+
      ".qgmdbg-endpoints,.qgmdbg-recent{display:flex;flex-direction:column;gap:4px;margin-top:6px}.qgmdbg-row{display:grid;grid-template-columns:1fr auto;gap:8px;padding:5px 7px;border-radius:7px;background:#07131d;border:1px solid #ffffff0d;font-size:9px}.qgmdbg-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#b9cfdd}.qgmdbg-row b{color:#fff}.qgmdbg-row.bad{border-color:#ff6f7440;background:#3a111744}.qgmdbg-trigger{margin-top:8px;padding:8px;border:1px solid #ff6f7470;border-radius:8px;background:#3a1117aa;color:#ffd7d9;font-size:9px;line-height:1.35;word-break:break-word}.qgmdbg-trigger strong{color:#ff8a8f}"+
      ".livedebug.qgm-limits-enabled{width:min(92vw,46vh)!important;max-width:92%!important;max-height:78vh!important;overflow:auto!important}"+
      "#qgm-quota-debug-mount{margin-top:.7vh;padding-top:.6vh;border-top:1px solid #ffd45e2a}"+
      "#qgm-quota-debug-mount .qgmdbg-note{font-size:.62vh;margin-bottom:.45vh;padding:.45vh}"+
      "#qgm-quota-debug-mount .qgmdbg-metric{padding:.35vh 0}"+
      "#qgm-quota-debug-mount .qgmdbg-metric>div:first-child{font-size:.62vh}"+
      "#qgm-quota-debug-mount .qgmdbg-metric b{font-size:.68vh}"+
      "#qgm-quota-debug-mount .qgmdbg-metric small{font-size:.55vh}"+
      "#qgm-quota-debug-mount .qgmdbg-grid{gap:.35vh;margin-top:.45vh}"+
      "#qgm-quota-debug-mount .qgmdbg-cell{padding:.42vh}"+
      "#qgm-quota-debug-mount .qgmdbg-cell span{font-size:.52vh}"+
      "#qgm-quota-debug-mount .qgmdbg-cell b{font-size:.62vh}"+
      "#qgm-quota-debug-mount .qgmdbg-section{font-size:.58vh;margin-top:.55vh;padding-top:.45vh}"+
      "#qgm-quota-debug-mount .qgmdbg-alert{font-size:.58vh;padding:.45vh;margin-top:.45vh}"+
      "@media(max-width:560px){.qgmdbg-toggle{width:38px;height:38px;font-size:18px}.qgmdbg-panel{top:98px}.qgmdbg-grid{grid-template-columns:1fr}}";
    document.head.appendChild(s);
  }

  var standalonePanel=null,standaloneButton=null,mount=null;
  function quotaHtml(){
    var alert="";
    var rate=ratePerMinute();
    var eps=topEndpoints();
    var endpointHtml=eps.length?eps.map(function(x){return '<div class="qgmdbg-row"><span>'+esc(x[0])+'</span><b>'+x[1]+'</b></div>'}).join(""):'<div class="qgmdbg-row"><span>No bridge requests captured yet</span><b>—</b></div>';
    var recentHtml=(usage.recent||[]).slice(0,6).map(function(x){var bad=String(x.status)==="429"||String(x.status)==="NETWORK ERROR";return '<div class="qgmdbg-row '+(bad?"bad":"")+'"><span>'+esc(x.method+" "+x.url)+'</span><b>'+esc(x.status)+'</b></div>'}).join("");
    if(usage.last429)alert="LAST 429: "+usage.last429+(usage.last429Body?"\nBODY: "+usage.last429Body:"");
    else if(usage.lastError)alert="LAST ERROR: "+usage.lastError;
    return ''+
      '<div class="qgmdbg-note"><strong>LIMIT DEBUG</strong> · local counters from this browser. Cloudflare account totals can be higher. Reset: <strong>00:00 UTC</strong>.</div>'+
      metric("WORKER REQUESTS","workerRequests",LIMITS.workerRequests)+
      metric("KV READS","kvReads",LIMITS.kvReads)+
      metric("KV WRITES","kvWrites",LIMITS.kvWrites)+
      metric("KV DELETES","kvDeletes",LIMITS.kvDeletes)+
      metric("KV LISTS","kvLists",LIMITS.kvLists)+
      '<div class="qgmdbg-section">REQUEST SOURCES</div>'+
      '<div class="qgmdbg-grid">'+
        '<div class="qgmdbg-cell"><span>TOKEN</span><b>'+usage.tokenRequests+'</b></div>'+
        '<div class="qgmdbg-cell"><span>PROFILE</span><b>'+usage.profileRequests+'</b></div>'+
        '<div class="qgmdbg-cell"><span>ANALYTICS</span><b>'+usage.analyticsPosts+'</b></div>'+
        '<div class="qgmdbg-cell"><span>OTHER BRIDGE</span><b>'+usage.otherBridgeRequests+'</b></div>'+
        '<div class="qgmdbg-cell"><span>HTTP 429</span><b>'+usage.http429+'</b></div>'+
        '<div class="qgmdbg-cell"><span>NETWORK ERRORS</span><b>'+usage.networkErrors+'</b></div>'+
        '<div class="qgmdbg-cell"><span>REQUEST RATE</span><b>'+rate+' / min</b></div>'+
        '<div class="qgmdbg-cell"><span>CF 1027 SEEN</span><b>'+usage.http1027+'</b></div>'+
        '<div class="qgmdbg-cell wide"><span>LAST REQUEST</span><b>'+esc(usage.lastMethod+" "+usage.lastUrl+" → "+usage.lastStatus)+'</b></div>'+
      '</div>'+
      '<div class="qgmdbg-section">WHAT IS GENERATING THE LOAD</div><div class="qgmdbg-endpoints">'+endpointHtml+'</div>'+
      '<div class="qgmdbg-section">RECENT BRIDGE REQUESTS</div><div class="qgmdbg-recent">'+(recentHtml||'<div class="qgmdbg-row"><span>No requests captured yet</span><b>—</b></div>')+'</div>'+
      (usage.last429?'<div class="qgmdbg-trigger"><strong>LIMIT TRIGGER EVIDENCE</strong><br>'+esc(usage.last429)+(usage.last429Body?'<br>'+esc(usage.last429Body):"")+'</div>':"")+
      '<div class="qgmdbg-alert">'+esc(alert)+'</div>';
  }
  function standaloneHtml(){
    return '<div class="qgmdbg-head"><div><b>🐞 DEBUG · LIMITS</b><br><span>QuizGameMaster v'+VERSION+'</span></div><button class="qgmdbg-close" type="button" aria-label="Close">×</button></div>'+quotaHtml();
  }
  function render(){
    if(mount)mount.innerHTML=quotaHtml();
    if(standalonePanel)standalonePanel.innerHTML=standaloneHtml();
  }
  function createStandalone(){
    if(document.getElementById("qgm-debug-toggle")||document.getElementById("debugtoggle"))return;
    standaloneButton=document.createElement("button");
    standaloneButton.id="qgm-debug-toggle";
    standaloneButton.className="qgmdbg-toggle";
    standaloneButton.type="button";
    standaloneButton.title="Debug limits";
    standaloneButton.setAttribute("aria-label","Open debug limits");
    standaloneButton.textContent="🐞";

    standalonePanel=document.createElement("div");
    standalonePanel.id="qgm-debug-panel";
    standalonePanel.className="qgmdbg-panel";
    document.body.appendChild(standalonePanel);
    document.body.appendChild(standaloneButton);

    standaloneButton.addEventListener("click",function(){
      var open=!standalonePanel.classList.contains("show");
      standalonePanel.classList.toggle("show",open);
      standaloneButton.classList.toggle("on",open);
      standaloneButton.setAttribute("aria-label",open?"Close debug limits":"Open debug limits");
      render();
    });
    standalonePanel.addEventListener("click",function(e){
      if(e.target&&e.target.classList.contains("qgmdbg-close")){
        standalonePanel.classList.remove("show");
        standaloneButton.classList.remove("on");
      }
    });
  }
  function mountIntoExisting(){
    var panel=document.getElementById("livedebug");
    var toggle=document.getElementById("debugtoggle");
    if(!panel||!toggle)return false;
    var oldBtn=document.getElementById("qgm-debug-toggle"),oldPanel=document.getElementById("qgm-debug-panel");
    if(oldBtn)oldBtn.remove();
    if(oldPanel)oldPanel.remove();
    standaloneButton=null;standalonePanel=null;
    panel.classList.add("qgm-limits-enabled");
    mount=document.getElementById("qgm-quota-debug-mount");
    if(!mount){
      mount=document.createElement("div");
      mount.id="qgm-quota-debug-mount";
      var log=document.getElementById("dbg-log");
      if(log&&log.parentNode===panel)panel.insertBefore(mount,log);
      else panel.appendChild(mount);
    }
    return true;
  }
  function boot(){
    injectStyle();
    if(!mountIntoExisting())createStandalone();
    render();
    setTimeout(function(){if(mountIntoExisting())render()},0);
    setTimeout(function(){if(mountIntoExisting())render()},500);
  }

  window.QGMDebug={
    version:VERSION,
    snapshot:function(){return Object.assign({},usage)},
    note:function(name,value){
      usage["note_"+String(name||"")]=String(value==null?"":value);
      save();
    },
    mark429:function(label,body){
      usage.http429++;
      usage.last429=String(label||"429")+" · "+new Date().toISOString();
      usage.last429Body=String(body||"").slice(0,500);
      save();
    },
    render:render
  };

  window.addEventListener("storage",function(e){
    if(e.key===key()){usage=load();render()}
  });
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
})();