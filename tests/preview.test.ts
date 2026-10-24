import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {activate} from '../src/preview';
function harness(path:string,text=''){
 const dom=new JSDOM('<div id="navigation"></div><div id="editor"></div>',{url:'https://ide.test'});const win=dom.window;
 for(const key of ['document','DOMParser','XMLSerializer','localStorage','KeyboardEvent'])globalThis[key]=win[key];
 const pending:any[]=[];globalThis.Image=class {constructor(){const img=win.document.createElement('img');Object.defineProperties(img,{naturalWidth:{value:80},naturalHeight:{value:40}});pending.push(img);return img;}} as any;
 let disconnected=false;globalThis.ResizeObserver=class{observe(){} disconnect(){disconnected=true;}} as any;
 const clean:any[]=[], listeners=new Map<string,Set<Function>>();let version=1;
 const model={uri:{toString:()=>path},getVersionId:()=>version,getValue:()=>text,isDisposed:()=>false};
 const editor={getModel:()=>model,focus(){},layout(){},onDidChangeModel:(fn:Function)=>on('model',fn),onDidChangeModelContent:(fn:Function)=>on('content',fn)};
 function on(event:string,fn:Function){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event)!.add(fn);return {dispose:()=>listeners.get(event)!.delete(fn)};}
 const host=win.document.getElementById('editor')!,container=win.document.createElement('div');host.replaceWith(container);container.append(host);const owners:any[]=[];
 const update=()=>{const current=owners.find(o=>o.active());host.hidden=current?.mode()==='preview';for(const o of owners){o.preview.hidden=o!==current||o.mode()==='editor';o.toolbar.hidden=o!==current;}};
 const layout={update,register(o:any){owners.push(o);container.append(o.preview);update();return ()=>{owners.splice(owners.indexOf(o),1);o.preview.remove();o.toolbar.remove();update();};}};
 let resolveRead:any;const read=()=>new Promise<string>(resolve=>resolveRead=resolve);
 const sdk={tr:(s:string)=>s,host:{editor,path:()=>path},api:{readImage:read},editorPreviewLayout:()=>layout,own:(c:any)=>clean.push(c),provide(){}};
 const controller=activate(sdk);
 return {dom,controller,pending,host,resolveRead:(s:string)=>resolveRead(s),edit(value:string){text=value;version++;listeners.get('content')?.forEach(fn=>fn());},dispose(){for(const c of clean.reverse())typeof c==='function'?c():c.dispose();},get disconnected(){return disconnected;},get listenerCount(){return [...listeners.values()].reduce((n,s)=>n+s.size,0);}};
}
test('live SVG updates, invalid XML recovery and complete disposal',async()=>{
 const h=harness('icon.svg','<svg width="80" height="40"><rect width="20"/></svg>');
 h.pending[0].onload();assert.equal(document.querySelector('#svg-preview')?.getAttribute('data-state'),'ready');
 assert.match(h.pending[0].src,/data:image\/svg\+xml/);h.controller.setMode('preview');assert.equal(h.host.hidden,true);
 h.edit('<svg><bad></svg>');await new Promise(r=>setTimeout(r,150));assert.equal(document.querySelector('#svg-preview')?.getAttribute('data-state'),'error');assert.ok(document.querySelector('[role=alert]'));
 h.edit('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"/>');await new Promise(r=>setTimeout(r,150));const stale=h.pending.at(-1);stale.onload();assert.equal(document.querySelector('#svg-preview')?.getAttribute('data-state'),'ready');
 h.dispose();assert.equal(h.host.hidden,false);assert.equal(document.querySelector('#svg-preview'),null);assert.equal(document.querySelector('#svg-toolbar'),null);assert.equal(h.listenerCount,0);assert.equal(h.disconnected,true);stale.onload();assert.equal(document.querySelector('#svg-preview'),null);h.dom.window.close();
});
test('rejects entity definitions and oversized SVG with recoverable UI',()=>{
 for(const text of ['<!DOCTYPE svg [<!ENTITY x "abc">]><svg/>','<svg>'+ ' '.repeat(2*1024*1024)+'</svg>']){const h=harness('bad.svg',text);assert.equal(document.querySelector('#svg-preview')?.getAttribute('data-state'),'error');assert.equal(h.pending.length,0);h.dispose();h.dom.window.close();}
});
