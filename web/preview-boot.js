(function(){'use strict';
var cfg=window.APEX_CONFIG,status=document.getElementById('boot-status'),urls=[];
function load(tag,url){return new Promise(function(resolve,reject){var el=document.createElement(tag);if(tag==='link'){el.rel='stylesheet';el.href=url;}else el.src=url;el.onload=resolve;el.onerror=function(){reject(Error('Meniu failas neįkeltas.'));};document.head.appendChild(el);});}
document.getElementById('boot-retry').onclick=function(){location.reload();};
ApexMenuCache.download(cfg,cfg.server).then(function(result){var m=result.manifest;
 window.APEX_CONTEXT={server:cfg.server,key:cfg.pairingKey,revision:m.revision,version:m.version,builtAt:m.builtAt,preview:true,standalone:false,monitor:false};
 var css=URL.createObjectURL(new Blob([result.bundle.files['tv.css']],{type:'text/css'})),js=URL.createObjectURL(new Blob([result.bundle.files['tv-app.js']],{type:'text/javascript'}));urls=[css,js];
 return load('link',css).then(function(){return load('script',js);}).then(function(){document.getElementById('boot').hidden=true;document.getElementById('app').hidden=false;ApexTV.start();});
}).catch(function(e){status.textContent=e.message||'Peržiūra neįkelta.';document.getElementById('boot-fix').hidden=false;document.getElementById('boot-retry').focus();}).finally(function(){urls.forEach(function(url){URL.revokeObjectURL(url);});});
}());