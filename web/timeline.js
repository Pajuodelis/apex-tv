/* Remote timeline selection is a draft until OK. No player calls or network work while sliding. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ApexTimeline=api;}(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
function bounds(raw){if(!raw||!Number.isFinite(raw.start)||!Number.isFinite(raw.end)||raw.start<0||raw.end<=raw.start||raw.end-raw.start>604800)return null;return{start:raw.start,end:raw.end,live:raw.live===true};}
function clamp(value,r){return Math.max(r.start,Math.min(r.end,value));}
function controller(){var r=null,draft=0,dirty=false,direction=0,started=0,lastAt=-Infinity;
return{
begin:function(range,position){r=bounds(range);if(!r||!Number.isFinite(position)){r=null;return false;}draft=clamp(position,r);dirty=false;direction=0;lastAt=-Infinity;return true;},
active:function(){return Boolean(r);},
snapshot:function(){return r?{start:r.start,end:r.end,live:r.live,position:draft,dirty:dirty}:null;},
sync:function(position){if(r&&!dirty&&Number.isFinite(position))draft=clamp(position,r);},
move:function(dir,at){if(!r||(dir!==-1&&dir!==1)||!Number.isFinite(at))return null;if(dir!==direction||at-lastAt>250||at<lastAt){direction=dir;started=at;}lastAt=at;var held=at-started,step=held>=3500?60:held>=1800?30:held>=600?10:5,next=clamp(draft+dir*step,r);if(next!==draft)dirty=true;draft=next;return draft;},
fraction:function(value){if(!r||!Number.isFinite(value))return null;var next=r.start+(r.end-r.start)*Math.max(0,Math.min(1,value));if(next!==draft)dirty=true;draft=next;direction=0;return draft;},
commit:function(latest){var current=bounds(latest),selected=r&&dirty&&current?clamp(draft,current):null;r=null;dirty=false;direction=0;return selected;},
cancel:function(){r=null;dirty=false;direction=0;}
};}
return{controller:controller};
}));
