import { approvedUrl, ServiceError } from './f1.mjs';
import ViewOptions from '../web/view-options.js';
import VideoQuality from '../web/video-quality.js';
const attr = (text, name) => text.match(new RegExp('\\b' + name + '\\s*=\\s*(["\\x27])([^"\\x27]*)\\1'))?.[2] || '';
const decode = value => value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const escape = value => value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
const replaceAttr = (text,name,value) => text.replace(new RegExp('(\\b'+name+'\\s*=\\s*)(["\\x27])[^"\\x27]*\\2'), (_match,prefix) => prefix+'"'+escape(value)+'"');
function integer(value) { if(!/^\d{1,20}$/.test(String(value))) throw new ServiceError('Netinkama medijos laiko žyma.',400); return BigInt(value); }
export function buildRelayManifest(stream, ticket, base, videoCodec = 'avc') {
  if (!['avc','hevc'].includes(videoCodec)) throw new ServiceError('Netinkamas TV vaizdo formatas.', 400);
  const videoPattern = videoCodec === 'hevc' ? /^(?:hev1|hvc1)\./ : /^avc[13]\./;
  const original = stream.manifestXML;
  if (!/^[a-f0-9]{48}$/.test(ticket) || typeof original !== 'string' || original.length > 2097152 || /<!DOCTYPE|<!ENTITY|<BaseURL[\s>]/i.test(original)) throw new ServiceError('Šio F1 aprašo TV perdavimas nepalaikomas.',422);
  const mpdTag=original.match(/<MPD\b[^>]*>/)?.[0];
  if(!mpdTag || attr(mpdTag,'type')!=='static' || (original.match(/<Period\b/g)||[]).length!==1) throw new ServiceError('TV perdavimas šiuo metu skirtas vieno periodo F1 įrašui.',422);
  const sourceUrl=new URL(approvedUrl(stream.manifestUrl)), local=new URL(base);
  const address=local.hostname.split('.').map(Number);
  const privateHost=/^(?:\d{1,3}\.){3}\d{1,3}$/.test(local.hostname) && address.every(part=>part<=255) &&
    (address[0]===127 || address[0]===10 || (address[0]===172 && address[1]>=16 && address[1]<=31) || (address[0]===192 && address[1]===168));
  if(local.protocol!=='http:' || !privateHost || local.username || local.password) throw new ServiceError('Netinkamas vietinis TV serveris.',400);
  const candidates=[...original.matchAll(/<AdaptationSet\b[^>]*>[\s\S]*?<\/AdaptationSet>/g)].map(match=>{
    const text=match[0], tag=text.match(/<AdaptationSet\b[^>]*>/)[0];
    const representations=[...text.matchAll(/<Representation\b[^>]*(?:\/>|>[\s\S]*?<\/Representation>)/g)].map(r=>({text:r[0],tag:r[0].match(/<Representation\b[^>]*>/)?.[0]||r[0]}));
    return {text,tag,representations,type:attr(tag,'contentType'),lang:attr(tag,'lang')};
  });
  const selection=VideoQuality.select(candidates,stream.videoQuality,videoCodec), video=selection?.set;
  const audios=candidates.filter(set=>set.representations.some(rep=>/^mp4a\./.test(attr(rep.tag,'codecs')||attr(set.tag,'codecs'))));
  const audio=stream.audioTrackId ? audios.find(set=>ViewOptions.audioId(set.text)===stream.audioTrackId) : audios.find(set=>/^(eng|en)$/i.test(set.lang)) || audios[0];
  if(stream.audioTrackId&&!audio)throw new ServiceError('F1 nepateikė pasirinkto garso takelio.',422);
  if(!video || !audio) throw new ServiceError('F1 nepateikė TV tinkamų vaizdo ir AAC takelių.',422);
  const slots=[], summaries=[];
  function adapt(set, type) {
    let text=set.text;
    const allowed=new Map();
    const preferred = type === 'video' ? selection.rep : null;
    for(const rep of set.representations) {
      const codec=attr(rep.tag,'codecs')||attr(set.tag,'codecs');
      const keep=type==='video' ? rep === preferred : /^mp4a\./.test(codec);
      if(!keep){text=text.replace(rep.text,'');continue;}
      const id=attr(rep.tag,'id'), bandwidth=attr(rep.tag,'bandwidth');
      if(!/^[A-Za-z0-9_.-]{1,128}$/.test(id) || !/^\d{1,12}$/.test(bandwidth)) throw new ServiceError('Neatpažintas F1 vaizdo takelio numeris.',422);
      allowed.set(id,{id,bandwidth});
    }
    if(!allowed.size)throw new ServiceError('F1 nepateikė TV tinkamo vaizdo takelio.',422);
    text=text.replace(/<SegmentTemplate\b[^>]*(?:\/>|>[\s\S]*?<\/SegmentTemplate>)/g, template=>{
      const tag=template.match(/<SegmentTemplate\b[^>]*>/)?.[0]||template;
      const timescale=integer(attr(tag,'timescale')||'1'), offset=integer(attr(tag,'presentationTimeOffset')||'0');
      const originalStart=integer(attr(tag,'startNumber')||'1');
      const numberShift=originalStart>1000000n && /\$Number/.test(attr(tag,'media')) ? originalStart-1n : 0n;
      let result=template;
      for(const kind of ['initialization','media']){
        const value=attr(tag,kind);if(!value)throw new ServiceError('Nepilnas F1 segmentų aprašas.',422);
        const index=slots.length, query=[];
        if(value.includes('$Time'))query.push('t=$Time$');
        if(value.includes('$Number'))query.push('n=$Number$');
        const path=local.origin+'/api/media/'+ticket+'/s'+index+'/$RepresentationID$.mp4'+(query.length?'?'+query.join('&'):'');
        slots.push({type,kind,value:decode(value),base:sourceUrl.href,host:sourceUrl.hostname,allowed,offset,timescale,numberShift,sequenceShift:numberShift ? originalStart : 0n});
        result=replaceAttr(result,kind,path);
      }
      if(numberShift) result=replaceAttr(result,'startNumber','1');
      if(offset){
        result=replaceAttr(result,'presentationTimeOffset','0');
        result=result.replace(/<S\b[^>]*>/g, segment=>{
          const t=attr(segment,'t');if(!t)return segment;
          const normalized=integer(t)-offset;
          if(normalized<0n)throw new ServiceError('Neatpažinta F1 segmento pradžia.',422);
          return replaceAttr(segment,'t',String(normalized));
        });
      }
      return result;
    });
    if(!/<SegmentTemplate\b/.test(text))throw new ServiceError('Šio F1 segmentavimo TV perdavimas nepalaikomas.',422);
    summaries.push({type,representations:allowed.size,language:set.lang});
    return text;
  }
  const selected=new Map([[video.text,adapt(video,'video')],[audio.text,adapt(audio,'audio')]]);
  const mpd=original.replace(/<AdaptationSet\b[^>]*>[\s\S]*?<\/AdaptationSet>/g,text=>selected.get(text)||'');
  return {mpd,slots,summaries,video:selection.metadata};
}
export function resolveRelayAsset(relay, index, id, params) {
  const slot=relay.slots[index], representation=slot?.allowed.get(id);
  if(!slot || !representation)throw new ServiceError('TV medijos failas nerastas.',404);
  for(const key of params.keys())if(!['t','n'].includes(key) || params.getAll(key).length!==1)throw new ServiceError('Netinkama medijos užklausa.',400);
  const values={RepresentationID:id,Bandwidth:representation.bandwidth};
  if(slot.value.includes('$Time'))values.Time=String(integer(params.get('t'))+slot.offset);
  if(slot.value.includes('$Number'))values.Number=String(integer(params.get('n'))+(slot.numberShift||0n));
  const template=slot.value.replace(/\$\$/g,'__APEX_LITERAL_DOLLAR__').replace(/\$(RepresentationID|Bandwidth|Time|Number)(?:%0(\d{1,2})d)?\$/g,(_m,name,pad)=>{
    const value=values[name];if(value===undefined || (pad && (Number(pad)>20 || name==='RepresentationID')))throw new ServiceError('Netinkamas F1 segmento parametras.',422);
    return pad?value.padStart(Number(pad),'0'):value;
  }).replace(/__APEX_LITERAL_DOLLAR__/g,'$');
  if(/\$(RepresentationID|Bandwidth|Time|Number)/.test(template))throw new ServiceError('Neatpažintas F1 segmento adresas.',422);
  const url=new URL(approvedUrl(new URL(template,slot.base).href));
  if(url.hostname!==slot.host)throw new ServiceError('F1 segmentas pakeitė medijos serverį.',403);
  return {url:url.href,slot,key:index+'/'+id+'/'+(params.get('t')||'')+'/'+(params.get('n')||'')};
}
export function rebaseMedia(input, slot) {
  if(slot.kind==='initialization' || (slot.offset===0n && !slot.sequenceShift))return input;
  const bytes=Buffer.from(input);
  function boxes(start,end,depth) {
    for(let at=start;at<end;){
      if(end-at<8)throw new ServiceError('Nebaigtas F1 MP4 blokas.',502);
      let size=bytes.readUInt32BE(at),header=8;
      const type=bytes.toString('ascii',at+4,at+8);
      if(size===1){if(end-at<16)throw new ServiceError('Nebaigtas F1 MP4 dydis.',502);const extended=bytes.readBigUInt64BE(at+8);if(extended>BigInt(end-at))throw new ServiceError('Netinkamas F1 MP4 dydis.',502);size=Number(extended);header=16;}
      if(size===0)size=end-at;
      if(size<header || size>end-at)throw new ServiceError('Netinkamas F1 MP4 dydis.',502);
      if((type==='moof'||type==='traf')&&depth<2)boxes(at+header,at+size,depth+1);
      if(type==='mfhd'&&depth===1&&slot.sequenceShift){
        const field=at+header+4;
        if(field+4>at+size)throw new ServiceError('Netinkamas F1 fragmento numeris.',502);
        const value=BigInt(bytes.readUInt32BE(field)),normalized=value-slot.sequenceShift;
        if(normalized<1n || normalized>4294967295n)throw new ServiceError('F1 fragmento numeris nesutampa su aprašu.',502);
        bytes.writeUInt32BE(Number(normalized),field);
      }
      if(type==='tfdt'&&depth===2){
        const version=bytes[at+header],field=at+header+4,len=version===1?8:4;
        if((version!==0&&version!==1)||field+len>at+size)throw new ServiceError('Netinkama F1 MP4 laiko žyma.',502);
        const value=version===1?bytes.readBigUInt64BE(field):BigInt(bytes.readUInt32BE(field));
        if(value<slot.offset)throw new ServiceError('F1 laiko žyma nesutampa su aprašu.',502);
        const normalized=value-slot.offset;
        if(version===1)bytes.writeBigUInt64BE(normalized,field);else bytes.writeUInt32BE(Number(normalized),field);
      }
      if(type==='sidx'){
        const version=bytes[at+header],scaleField=at+header+8,field=at+header+12,len=version===1?8:4;
        if((version!==0&&version!==1)||field+len>at+size)throw new ServiceError('Netinkamas F1 MP4 indeksas.',502);
        const scale=BigInt(bytes.readUInt32BE(scaleField)),shift=slot.offset*scale/slot.timescale;
        const value=version===1?bytes.readBigUInt64BE(field):BigInt(bytes.readUInt32BE(field));
        if(value>=shift){const normalized=value-shift;if(version===1)bytes.writeBigUInt64BE(normalized,field);else bytes.writeUInt32BE(Number(normalized),field);}
      }
      at+=size;
    }
  }
  boxes(0,bytes.length,0);return bytes;
}
export async function readMediaBody(response, max=32*1024*1024) {
  if(Number(response.headers.get('content-length')||0)>max){await response.body?.cancel();throw new ServiceError('F1 medijos fragmentas per didelis.',502);}
  const reader=response.body?.getReader();if(!reader)throw new ServiceError('Tuščias F1 medijos fragmentas.',502);
  const chunks=[];let length=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw new ServiceError('F1 medijos fragmentas per didelis.',502);}chunks.push(Buffer.from(value));}}
  finally{reader.releaseLock();}
  return Buffer.concat(chunks,length);
}
export function mediaRange(header, length) {
  if(!header)return {start:0,end:length-1,status:200};
  const match=String(header).match(/^bytes=(\d*)-(\d*)$/);
  if(!match || (!match[1]&&!match[2]))throw new ServiceError('Netinkamas medijos diapazonas.',416);
  const start=match[1]?Number(match[1]):Math.max(0,length-Number(match[2])),end=match[1]?(match[2]?Math.min(Number(match[2]),length-1):length-1):length-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=length||end<start)throw new ServiceError('Medijos diapazonas nerastas.',416);
  return {start,end,status:206};
}
