/* Highest compatible F1 video rendition. Public format metadata only. */
(function(global){
'use strict';
function attr(text,name){var m=String(text||'').match(new RegExp('\\b'+name+'\\s*=\\s*(["\\x27])([^"\\x27]*)\\1'));return m?m[2]:'';}
function mode(value){if(value===undefined||value===null||value==='')return 'best';if(value!=='best'&&value!=='720p')throw Error('Netinkamas vaizdo kokybės pasirinkimas.');return value;}
function fps(value){var match=String(value||'').match(/^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/);if(!match)return 0;var result=Number(match[1])/Number(match[2]||1);return Number.isFinite(result)&&result>0?result:0;}
function select(sets,value,codec){var selected=null,maximum=mode(value)==='720p'?720:1080;codec=codec||'avc';if(codec!=='avc'&&codec!=='hevc')throw Error('Netinkamas TV vaizdo formatas.');var pattern=codec==='hevc'?/^(hev1|hvc1)\./:/^avc[13]\./;
 (sets||[]).forEach(function(set){if(/schemeIdUri\s*=\s*["'][^"']*trickmode/i.test(set.text||''))return;
  (set.reps||set.representations||[]).forEach(function(rep){var get=function(name){return attr(rep.tag,name)||attr(set.tag,name);};var width=Number(get('width')),height=Number(get('height')),bandwidth=Number(get('bandwidth')),frameValue=get('frameRate'),frameRate=fps(frameValue),id=attr(rep.tag,'id'),format=get('codecs');
   if(!pattern.test(format)||!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width>(maximum===720?1280:1920)||height>maximum||!Number.isFinite(bandwidth)||bandwidth<=0||bandwidth>100000000||!/^\d{1,12}$/.test(get('bandwidth'))||!/^[-A-Za-z0-9_.]{1,128}$/.test(id)||/iframe|trickmode/i.test(id)||(frameValue&&!frameRate)||(frameRate&&frameRate<1)||frameRate>120)return;
   var candidate={set:set,rep:rep,metadata:{id:id,codec:format,width:width,height:height,frameRate:frameRate,bandwidth:bandwidth}};
   var old=selected&&selected.metadata,area=width*height;
   if(!old||area>old.width*old.height||(area===old.width*old.height&&(frameRate>old.frameRate||(frameRate===old.frameRate&&(bandwidth>old.bandwidth||(bandwidth===old.bandwidth&&id<old.id))))))selected=candidate;
  });
 });return selected;
}
function label(metadata){if(!metadata||!metadata.height)return '';return metadata.height+'p'+(metadata.frameRate?' · '+Math.round(metadata.frameRate*100)/100+' fps':'')+(metadata.bandwidth?' · '+(metadata.bandwidth/1000000).toFixed(2)+' Mb/s':'');}
var api={mode:mode,select:select,fps:fps,label:label};if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.ApexVideoQuality=api;
}(typeof window!=='undefined'?window:globalThis));