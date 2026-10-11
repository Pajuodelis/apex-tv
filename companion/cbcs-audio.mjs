/* CBCS audio: expand an empty constant-IV sample count for older MP4 readers.
   No encrypted sample, IV, key identifier, PSSH or licence is changed. */

  'use strict';
  function bytes(value){return value instanceof Uint8Array?value:new Uint8Array(value);}
  function read(input){
    var b=bytes(input),v=new DataView(b.buffer,b.byteOffset,b.byteLength),desc={scheme:'',aac:false,pattern:-1};
    function text(at,n){var s='';for(var i=0;i<n;i++)s+=String.fromCharCode(b[at+i]);return s;}
    function walk(start,end,depth){if(depth>12)throw Error('MP4 nesting');for(var at=start;at+8<=end;){var size=v.getUint32(at),type=text(at+4,4),p=at+8;if(size<8||at+size>end)throw Error('MP4 bounds');
      if(type==='schm'&&size>=20)desc.scheme=text(p+4,4);
      if(type==='enca')desc.aac=true;
      if(type==='tenc'&&size>=49&&b[p]===1){desc.pattern=b[p+5];desc.encrypted=b[p+6];desc.ivSize=b[p+7];desc.id=b.slice(p+8,p+24);desc.constantLength=b[p+24];desc.iv=b.slice(p+25,p+25+desc.constantLength);}
      if(/^(moov|trak|mdia|minf|stbl|sinf|schi)$/.test(type))walk(p,at+size,depth+1);
      if(type==='stsd')walk(p+8,at+size,depth+1);
      if(type==='enca'&&size>=36)walk(p+28,at+size,depth+1);
      at+=size;
    }}walk(0,b.length,0);return desc.scheme==='cbcs'&&desc.aac&&desc.pattern===0&&desc.encrypted===1&&desc.ivSize===0&&desc.constantLength===16&&desc.iv.length===16?desc:null;
  }
  function repair(input,descriptor){
    if(!descriptor)return {bytes:input,changed:0};var original=bytes(input),b=new Uint8Array(original),v=new DataView(b.buffer),changed=0;
    function text(at){return String.fromCharCode(b[at],b[at+1],b[at+2],b[at+3]);}
    function equal(at,wanted){for(var i=0;i<wanted.length;i++)if(b[at+i]!==wanted[i])return false;return true;}
    function children(start,end){var out=[];for(var at=start;at<end;){if(at+8>end)throw Error('MP4 bounds');var size=v.getUint32(at);if(size<8||at+size>end)throw Error('MP4 bounds');out.push({at:at,p:at+8,end:at+size,size:size,type:text(at+4)});at+=size;}return out;}
    children(0,b.length).filter(function(box){return box.type==='moof';}).forEach(function(moof){children(moof.p,moof.end).filter(function(box){return box.type==='traf';}).forEach(function(traf){
      var list=children(traf.p,traf.end),runs=list.filter(function(box){return box.type==='trun';}),senc=list.filter(function(box){return box.type==='senc';});
      if(senc.length!==1||senc[0].size!==16||v.getUint32(senc[0].p)!==0||v.getUint32(senc[0].p+4)!==0||runs.length!==1)return;
      var count=v.getUint32(runs[0].p+4);if(!count||count>100000)return;
      var groups=list.filter(function(box){return box.type==='sgpd'&&box.size>=16&&text(box.p+4)==='seig';});
      if(groups.length){var g=groups[0],p=g.p;if(groups.length!==1||g.size!==61||b[p]!==1||v.getUint32(p+8)!==37||v.getUint32(p+12)!==1)return;var entry=p+16;
        if(b[entry+1]!==0||b[entry+2]!==1||b[entry+3]!==0||!equal(entry+4,descriptor.id)||b[entry+20]!==16||!equal(entry+21,descriptor.iv))return;
        var mapping=list.filter(function(box){return box.type==='sbgp'&&box.size>=16&&text(box.p+4)==='seig';});
        if(mapping.length!==1||mapping[0].size!==28||v.getUint32(mapping[0].p)!==0||v.getUint32(mapping[0].p+8)!==1||v.getUint32(mapping[0].p+12)!==count||v.getUint32(mapping[0].p+16)!==65537)return;
      }
      // Constant IV and whole-sample CBCS need zero bytes per sample entry.
      v.setUint32(senc[0].p+4,count);changed++;
    });});return {bytes:changed?b.buffer:input,changed:changed};
  }
  export {read as readAudioDescriptor,repair as repairAudioSampleCount};
