/* Service-supplied viewing choices. No invented feeds or audio languages. ES5 for Tizen 6. */
(function (root, factory) {
  var api=factory(); if(typeof module==='object'&&module.exports)module.exports=api; else root.ApexViewOptions=api;
}(typeof window!=='undefined'?window:this,function(){
  'use strict';
  function attr(text,name){var m=text.match(new RegExp('\\b'+name+'\\s*=\\s*(["\\x27])([^"\\x27]*)\\1'));return m?m[2]:'';}
  function clean(value,max){return String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max||120);}
  function decode(value){return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
  function language(value){var v=clean(value,24).toLowerCase();return /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/.test(v)?v:'und';}
  function languageName(value){var v=language(value),names={eng:'Anglų',en:'Anglų',deu:'Vokiečių',ger:'Vokiečių',de:'Vokiečių',fra:'Prancūzų',fre:'Prancūzų',fr:'Prancūzų',spa:'Ispanų',es:'Ispanų',por:'Portugalų',pt:'Portugalų',nld:'Nyderlandų',dut:'Nyderlandų',nl:'Nyderlandų',ita:'Italų',it:'Italų',lit:'Lietuvių',lt:'Lietuvių',und:'Garso takelis'};return names[v.split('-')[0]]||v.toUpperCase();}
  function audioId(text){
    var head=text.match(/<AdaptationSet\b[^>]*>/);if(!head)return '';
    var id=attr(head[0],'id');if(/^[A-Za-z0-9_.:-]{1,120}$/.test(id))return 'set:'+id;
    var reps=text.match(/<Representation\b[^>]*>/g)||[];for(var i=0;i<reps.length;i++){var codec=attr(reps[i],'codecs')||attr(head[0],'codecs'),repId=attr(reps[i],'id');if(codec==='mp4a.40.2'&&/^[A-Za-z0-9_.:-]{1,120}$/.test(repId))return 'rep:'+repId;}
    return '';
  }
  function audioTracks(xml){
    if(typeof xml!=='string'||xml.length>2097152||/<!DOCTYPE|<!ENTITY/i.test(xml))return [];
    var result=[],seen={},groups=xml.match(/<AdaptationSet\b[^>]*>[\s\S]*?<\/AdaptationSet>/g)||[];
    for(var i=0;i<groups.length&&result.length<32;i++){
      var text=groups[i],head=text.match(/<AdaptationSet\b[^>]*>/)[0],reps=text.match(/<Representation\b[^>]*>/g)||[],aac=false;
      if(/schemeIdUri\s*=\s*["'][^"']*trickmode/i.test(text))continue;
      for(var j=0;j<reps.length;j++)if((attr(reps[j],'codecs')||attr(head,'codecs'))==='mp4a.40.2')aac=true;
      var id=audioId(text);if(!aac||!id||seen[id])continue;seen[id]=true;
      var lang=language(attr(head,'lang')),label=(text.match(/<Label\b[^>]*>([^<]{0,160})<\/Label>/)||[])[1]||'',name=languageName(lang);
      label=clean(decode(label),80); result.push({id:id,language:lang,label:label?name+' · '+label:name});
    }
    var counts=Object.create(null);result.forEach(function(track){counts[track.label]=(counts[track.label]||0)+1;});result.forEach(function(track,index){if(counts[track.label]>1)track.label+=' · '+(index+1);});
    return result;
  }
  function selectAudio(xml,id,preferred){
    var tracks=audioTracks(xml),track=null;
    if(id){for(var i=0;i<tracks.length;i++)if(tracks[i].id===id)track=tracks[i];if(!track)throw Error('F1 nepateikė pasirinkto garso takelio.');return track;}
    var wanted=language(preferred);for(var j=0;j<tracks.length;j++)if(preferred&&tracks[j].language===wanted&&!track)track=tracks[j];
    for(var k=0;k<tracks.length;k++)if(/^(eng|en)$/i.test(tracks[k].language)&&!track)track=tracks[k];return track||tracks[0]||null;
  }
  function channels(data){
    var source=data&&Array.isArray(data.channels)?data.channels:[],seen={},result=[];
    for(var i=0;i<source.length&&result.length<64;i++){
      var channel=source[i],id=String(channel&&channel.id||'');if(!/^\d{1,12}$/.test(id)||seen[id])continue;seen[id]=true;
      result.push({id:id,title:clean(channel.title,120)||'F1 kamera '+(result.length+1),type:clean(channel.type,60),default:channel.default===true});
    }return result;
  }
  return {audioId:audioId,audioTracks:audioTracks,selectAudio:selectAudio,channels:channels,language:language,languageName:languageName};
}));