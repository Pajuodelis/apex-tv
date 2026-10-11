/* Match a preferred driver's name against each content's actual F1 channels. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ApexFavoriteDriver=api;}(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';var KEY='apex-favorite-driver-v1';
  function name(raw){return String(raw||'').replace(/[\x00-\x1f\x7f]/g,'').replace(/^(?:POV|OBC|OB|Onboard)\b\s*[·:—-]?\s*/i,'').replace(/\s*[·:—-]\s*(?:POV|OBC|Onboard)\s*$/i,'').trim().slice(0,80);}
  function key(raw){var v=name(raw).toLowerCase();return (v.normalize?v.normalize('NFD').replace(/[\u0300-\u036f]/g,''):v).replace(/[^a-z0-9]+/g,' ').trim();}
  function driver(channel){if(!channel||!/^\d{1,12}$/.test(String(channel.id))||!(/^(?:obc|ob|onboard)$/i.test(channel.type)||/\bpov\b|\bonboard\b/i.test(channel.title)))return null;var value=name(channel.title);return key(value)&&!/^\d+$/.test(value)?{name:value,key:key(value)}:null;}
  function match(channels,preferred){if(!preferred||!preferred.key)return null;return channels.filter(function(channel){var value=driver(channel);return value&&value.key===preferred.key;})[0]||null;}
  function store(storage){var saved=null,recent=[];try{var raw=JSON.parse(storage&&storage.getItem(KEY)||'null');if(raw&&raw.name&&raw.key===key(raw.name))saved={name:name(raw.name),key:key(raw.name)};if(raw&&Array.isArray(raw.recent))recent=raw.recent.slice(0,24).map(name).filter(function(v){return key(v);});}catch(_){}
    function save(){try{if(storage)storage.setItem(KEY,JSON.stringify({name:saved?saved.name:'',key:saved?saved.key:'',recent:recent}));}catch(_){}}
    return{get:function(){return saved?{name:saved.name,key:saved.key}:null;},recent:function(){return recent.slice();},observe:function(channels){var seen={};recent=channels.map(driver).filter(Boolean).map(function(v){return v.name;}).concat(recent).filter(function(v){var k=key(v);if(seen[k])return false;seen[k]=true;return true;}).slice(0,24);save();},set:function(raw){var value=name(raw);if(!value||!key(value))return false;saved={name:value,key:key(value)};save();return true;},clear:function(){saved=null;recent=[];save();}};
  }
  return{name:name,key:key,driver:driver,match:match,store:store};
}));