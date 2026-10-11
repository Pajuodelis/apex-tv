/* Bounded playback recovery and quality decisions. No credentials or media bytes. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ApexPlaybackHealth=api;}(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function liveWindow(raw,position){
    var parts=typeof raw==='string'?raw.split('|'):[],start=Number(parts[0])/1000,end=Number(parts[1])/1000;
    if(parts.length!==2||!/^\d+(?:\.\d+)?$/.test(parts[0])||!/^\d+(?:\.\d+)?$/.test(parts[1])||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>Number.MAX_SAFE_INTEGER/1000)return null;
    return {start:start,end:end,duration:end-start,delay:Number.isFinite(position)?Math.max(0,end-position):null,edge:Math.max(start,end-3)};
  }
  function seekLive(window,position,delta){if(!window||!Number.isFinite(position)||!Number.isFinite(delta))return null;return Math.max(window.start,Math.min(window.edge,position+delta));}
  function retryKind(raw){var message=String(raw&&raw.message||raw||'');
    if(/(?:HTTP\s*401|sesija.*(?:pasibaig|nebegalioj)|session.*expired|token.*expired)/i.test(message))return 'session';
    if(/HTTP\s*(?:403|400|404|422)|nepateikė.*(?:kanalo|takelio)|atmetė licencijos|CDM|NOT_SUPPORTED|netinkam|nesuderinam|neatpažint.*server/i.test(message))return '';
    return /HTTP\s*(?:408|410|429|5\d\d)|CONNECTION_FAILED|network|connection|timeout|nepasieki|nutrūko|srauto.*pasikeitė|takelis pasikeitė|per 45 sek|vaizdo sesija pasibaigė/i.test(message)?'network':'';
  }
  function controller(clock){clock=clock||Date.now;var attempts=0,sessionRefresh=false,bufferAt=null,stalls=[],lastBad=0,stableAt=clock(),lowered=false,lastSwitch=clock(),upgradeFailures=0,upgradeAt=0,lastTick=null,lastPosition=null,cooldownUntil=0;
    function reset(){attempts=0;sessionRefresh=false;bufferAt=null;stalls=[];lastBad=0;stableAt=clock();lowered=false;lastSwitch=clock();upgradeFailures=0;upgradeAt=0;lastTick=null;lastPosition=null;cooldownUntil=0;}
    function retry(error){var kind=retryKind(error);if(!kind||attempts>=3||(kind==='session'&&sessionRefresh))return null;attempts++;if(kind==='session')sessionRefresh=true;stableAt=clock();return{attempt:attempts,delay:[2000,5000,10000][attempts-1],refreshSession:kind==='session'};}
    function buffering(started){var now=clock();if(started){if(bufferAt===null)bufferAt=now;return;}if(bufferAt!==null){var elapsed=now-bufferAt;bufferAt=null;if(elapsed>=1800){stalls.push({at:now,duration:elapsed});lastBad=now;stableAt=now;}}}
    function switched(mode,automatic){var now=clock();lastSwitch=now;stableAt=now;bufferAt=null;stalls=[];lastTick=null;lastPosition=null;
      if(!automatic){lowered=false;upgradeAt=0;upgradeFailures=0;attempts=0;return;}
      if(mode==='720p'){if(upgradeAt&&now-upgradeAt<90000)upgradeFailures++;lowered=true;lastBad=now;}
      else{lowered=false;upgradeAt=now;}
    }
    function failed(currentMode,attemptedMode){var now=clock();lastSwitch=now;stableAt=now;bufferAt=null;stalls=[];lowered=currentMode==='720p';if(attemptedMode==='best'){upgradeFailures++;cooldownUntil=now+600000;}else cooldownUntil=now+90000;}
    function tick(options){options=options||{};var now=clock();if(options.paused||options.busy||options.offline){stableAt=now;lastTick=now;lastPosition=options.position;return null;}
      if(Number.isFinite(options.position)){
        if(lastTick!==null&&now-lastTick>=800&&now-lastTick<4000&&options.position<=lastPosition+.05&&bufferAt===null)bufferAt=lastTick;
        else if(lastPosition!==null&&options.position>lastPosition+.1&&bufferAt!==null)buffering(false);
        lastPosition=options.position;lastTick=now;
      }
      stalls=stalls.filter(function(s){return now-s.at<90000;});
      if(now<cooldownUntil||options.preference!=='best'||options.enabled===false)return null;
      var longStall=bufferAt!==null&&now-bufferAt>=12000,problems=stalls.length>=3||stalls.some(function(s){return s.duration>=12000;});
      if(options.mode==='best'&&(longStall||problems)&&now-lastSwitch>=15000){switched('720p',true);return '720p';}
      var speed=options.transfer,required=Number(options.bestBandwidth)||6144000;
      if(options.mode==='720p'&&lowered&&bufferAt===null&&now-stableAt>=180000&&now-lastBad>=180000&&now-lastSwitch>=(upgradeFailures?600000:180000)&&speed&&speed.samples>=4&&now-speed.at<30000&&speed.bps>=required*1.5){switched('best',true);return 'best';}
      if(now-stableAt>=120000&&bufferAt===null){attempts=0;sessionRefresh=false;}
      return null;
    }
    return{reset:reset,failed:failed,retry:retry,buffering:buffering,switched:switched,tick:tick,snapshot:function(){return{attempts:attempts,buffering:bufferAt!==null,lowered:lowered,upgradeFailures:upgradeFailures};}};
  }
  return{liveWindow:liveWindow,seekLive:seekLive,retryKind:retryKind,controller:controller};
}));