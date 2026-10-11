(function (global) {
  'use strict';
  function socketWorker() {
    var api, native, listener, timer, nonce, clients = {}, stopped = false, next = 0;
    var encoder = new TextEncoder(), decoder = new TextDecoder('utf-8');
    function note(type, data) { postMessage(Object.assign({type:type}, data)); }
    function close(client) { if (!client) return; delete clients[client.id]; try { native.close(client.fd); } catch (_) {} }
    function wouldBlock(error, fd) {
      var code; try { code = native.getErrorCode(fd); } catch (_) {}
      return code === api.ErrorCodes.EAGAIN || code === api.ErrorCodes.EWOULDBLOCK;
    }
    function response(client, status, bytes, contentType) {
      var size=bytes.byteLength, start=0, end=size-1, body=bytes;
      if(status===200&&client.range) {
        var m=client.range.match(/^bytes=(\d*)-(\d*)$/);
        if(!m||(!m[1]&&!m[2]))status=416;
        else {
          start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
          end=m[1]?(m[2]?Math.min(Number(m[2]),size-1):size-1):size-1;
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)status=416;
          else {status=206;body=bytes.subarray(start,end+1);}
        }
      }
      if(status===416)body=new Uint8Array(0);
      var words={200:'OK',206:'Partial Content',400:'Bad Request',404:'Not Found',405:'Method Not Allowed',416:'Range Not Satisfiable',500:'Internal Server Error',502:'Bad Gateway',503:'Service Unavailable'};
      var h='HTTP/1.1 '+status+' '+(words[status]||'Error')+'\r\nConnection: close\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAccept-Ranges: bytes\r\nContent-Type: '+contentType+'\r\nContent-Length: '+body.byteLength+'\r\n';
      if(status===206)h+='Content-Range: bytes '+start+'-'+end+'/'+size+'\r\n';
      if(status===416)h+='Content-Range: bytes */'+size+'\r\n';
      client.header=encoder.encode(h+'\r\n');client.body=client.method==='HEAD'?new Uint8Array(0):body;client.pos=0;client.waiting=false;
    }
    function read(client) {
      var buffer=new Uint8Array(4096), count;
      try { count=native.recv(client.fd,buffer,0); } catch(e) {if(!wouldBlock(e,client.fd))close(client);return;}
      if(count===0){close(client);return;}if(count<0)return;
      client.input+=decoder.decode(buffer.subarray(0,count));
      if(client.input.length>8192){response(client,400,new Uint8Array(0),'text/plain');return;}
      var end=client.input.indexOf('\r\n\r\n');if(end<0)return;
      var lines=client.input.slice(0,end).split('\r\n'), first=lines.shift().match(/^(GET|HEAD) (\/[^ ]*) HTTP\/1\.[01]$/);
      if(!first){response(client,405,new Uint8Array(0),'text/plain');return;}
      client.method=first[1];client.path=first[2];client.range='';
      if(client.path.indexOf('/'+nonce+'/')!==0||client.path.length>1024){response(client,404,new Uint8Array(0),'text/plain');return;}
      var ranges=lines.filter(function(line){return /^range:/i.test(line);});
      if(ranges.length>1){response(client,400,new Uint8Array(0),'text/plain');return;}
      if(ranges.length)client.range=ranges[0].slice(6).trim();
      client.waiting=true;client.input='';
      note('request',{id:client.id,path:client.path.slice(nonce.length+1)});
    }
    function send(client) {
      var bytes=client.header||client.body;
      if(!bytes){close(client);return;}
      var count;
      try {count=native.send(client.fd,bytes.subarray(client.pos,Math.min(bytes.length,client.pos+262144)),api.MsgFlags.MSG_NOSIGNAL||0);}catch(e){if(!wouldBlock(e,client.fd))close(client);return;}
      if(count<=0)return;client.pos+=count;
      if(client.pos===bytes.length){if(client.header){client.header=null;client.pos=0;if(!client.body.length)close(client);}else close(client);}
    }
    function tick() {
      if(stopped)return;
      try {
        var listening=new api.PollFd(listener,api.PollFlags.POLLIN), active=Object.keys(clients).map(function(id){return clients[id];});
        var entries=[listening].concat(active.map(function(c){return new api.PollFd(c.fd,c.header||c.body?api.PollFlags.POLLOUT:api.PollFlags.POLLIN);}));
        native.poll(entries,0);
        if(listening.revents&api.PollFlags.POLLIN) {
          var fd=native.accept4(listener,api.SockFlags.SOCK_NONBLOCK);
          if(Object.keys(clients).length>=16){native.close(fd);}else{var id=++next;clients[id]={fd:fd,id:id,input:'',since:Date.now(),waiting:false};}
        }
        active.forEach(function(c,i){
          if(Date.now()-c.since>30000){close(c);return;}
          var events=entries[i+1].revents;
          if(c.header||c.body){if(events&api.PollFlags.POLLOUT)send(c);}
          else if(!c.waiting&&(events&api.PollFlags.POLLIN))read(c);
          if(events&(api.PollFlags.POLLERR|api.PollFlags.POLLNVAL))close(c);
        });
      }catch(e){note('error',{message:String(e.name||'SocketError')+': '+String(e.message||'').slice(0,100)});}
      timer=setTimeout(tick,Object.keys(clients).length?4:20);
    }
    onmessage=function(event) {
      var data=event.data;
      if(data.type==='start') {
        nonce=data.nonce;
        try {
          api=self.tizentvwasm;
          if(!api||!api.SocketsManager||!api.NetAddress)throw Error('Samsung sockets API unavailable; manager='+(api&&typeof api.SocketsManager)+'; host='+(api&&typeof api.SocketsHostBindings));
          native=api.SocketsManager;listener=native.create('af_inet','sock_stream',api.SockFlags.SOCK_NONBLOCK);
          native.bind(listener,new api.NetAddress('af_inet',new Uint8Array([127,0,0,1]),0));native.listen(listener,16);
          var address=native.getSockName(listener);
          if(!address.port||String(Array.from(address.bytes))!=='127,0,0,1')throw Error('Loopback bind invalid');
          note('ready',{port:address.port});tick();
        }catch(e){note('error',{message:String(e.name||'SocketError')+': '+String(e.message||'').slice(0,160)});}
      } else if(data.type==='response') {var c=clients[data.id];if(c&&c.waiting)response(c,data.status||200,new Uint8Array(data.bytes),data.contentType||'application/octet-stream');}
      else if(data.type==='stop'){stopped=true;clearTimeout(timer);Object.keys(clients).forEach(function(id){close(clients[id]);});try{native.close(listener);}catch(_){}note('closed',{});}
    };
  }
  function open(handler, diagnostic) {
    var worker, source, closed=false, settled=false, port=0, pending;
    var nonce=Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(16)),function(b){return ('0'+b.toString(16)).slice(-2);}).join('');
    var result=new Promise(function(resolve,reject){pending={resolve:resolve,reject:reject};});
    var timeout=setTimeout(function(){if(!settled){settled=true;stop();pending.reject(Error('TV vietinis ryšys neatsako.'));}},6000);
    function stop(){if(closed)return;closed=true;clearTimeout(timeout);if(worker){try{worker.postMessage({type:'stop'});}catch(_){}setTimeout(function(){worker.terminate();},100);}if(source)URL.revokeObjectURL(source);}
    try {
      source=URL.createObjectURL(new Blob(['('+socketWorker.toString()+')();'],{type:'application/javascript'}));worker=new Worker(source);
      worker.onerror=function(){if(!settled){settled=true;stop();pending.reject(Error('TV ryšio darbuotojas nepaleistas.'));}};
      worker.onmessage=function(event){
        var data=event.data;if(closed)return;
        if(data.type==='ready'){port=data.port;settled=true;clearTimeout(timeout);pending.resolve({url:'http://127.0.0.1:'+port+'/'+nonce,stop:stop});}
        else if(data.type==='error'){if(diagnostic)diagnostic('tv_socket_error',{error:data.message});if(!settled){settled=true;stop();pending.reject(Error(data.message));}}
        else if(data.type==='request')Promise.resolve().then(function(){return handler(data.path);}).then(function(response){
          if(closed)return;var bytes=response.bytes instanceof Uint8Array?response.bytes:new Uint8Array(response.bytes);
          var copy=bytes.slice().buffer;worker.postMessage({type:'response',id:data.id,bytes:copy,status:response.status||200,contentType:response.contentType},[copy]);
        },function(e){if(!closed)worker.postMessage({type:'response',id:data.id,status:e.status===404?404:502,bytes:new ArrayBuffer(0),contentType:'text/plain'});if(diagnostic)diagnostic('tv_socket_asset_error',{error:String(e.message||e).slice(0,160)});});
      };worker.postMessage({type:'start',nonce:nonce});
    }catch(e){settled=true;stop();pending.reject(e);}
    return result;
  }
  function probe(diagnostic) {
    var relay;
    return open(function(path){if(path!=='/probe')throw Object.assign(Error('Not found'),{status:404});return {bytes:new TextEncoder().encode('apex-tv-loopback'),contentType:'text/plain'};},diagnostic).then(function(server){relay=server;return new Promise(function(resolve,reject){var q=new XMLHttpRequest();q.open('GET',server.url+'/probe');q.timeout=4000;q.onload=function(){if(q.status===200&&q.responseText==='apex-tv-loopback')resolve(true);else reject(Error('TV vietinio ryšio atsakymas netinkamas.'));};q.onerror=q.ontimeout=function(){reject(Error('TV nepasiekė vietinio grotuvo ryšio.'));};q.send();});}).then(function(){relay.stop();diagnostic('tv_socket_probe',{engine:'127.0.0.1 HTTP worker; independent of PC; received exact response'});return true;},function(e){if(relay)relay.stop();diagnostic('tv_socket_probe_failed',{error:e.message});return false;});
  }
  global.ApexNativeRelay={open:open,probe:probe};
}(typeof window!=='undefined'?window:globalThis));
