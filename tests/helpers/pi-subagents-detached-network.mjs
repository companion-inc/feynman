// Loaded through NODE_OPTIONS in both the driver and the real detached runner.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
const home = process.env.HOME;
if (!home) throw new Error('Offline detached test requires HOME');
function record(type, extra = {}) {
 fs.appendFileSync(path.join(home, 'network-proof.jsonl'), JSON.stringify({type,pid:process.pid,...extra})+'\n');
}
function deny() { record('blocked-network',{stack:new Error().stack}); throw new Error('Offline test forbids external network'); }
function local(args) {
 if (Array.isArray(args[0])) args=args[0];
 let value = typeof args[0] === 'object' ? args[0]?.path : args[0];
 if (typeof value !== 'string') return false;
 if (process.platform === 'win32') {
  // tsx uses the Windows named-pipe namespace followed by its temp-file
  // path. Accept only pipes whose embedded path is in this isolated HOME.
  const prefix = ['\\\\?\\pipe\\', '\\\\.\\pipe\\'].find(item => value.startsWith(item));
  if (!prefix) return false;
  value = value.slice(prefix.length);
  return path.resolve(value).toLowerCase().startsWith(path.resolve(home).toLowerCase()+path.sep);
 }
 return path.resolve(value).startsWith(path.resolve(home)+path.sep);
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
 if (!local(args)) return deny();
 record('local-ipc-connect'); return connect.apply(this,args);
};
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function(...args) {
 if (!local(args)) return deny();
 record('local-ipc-listen'); return listen.apply(this,args);
};
globalThis.fetch = async()=>deny();
http.request = deny; https.request = deny; dgram.createSocket = deny;
record('network-guard-loaded');
