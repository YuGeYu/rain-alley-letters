const port = process.argv[2];
(async () => {
 const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 const w = new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 w.onopen = () => w.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression: process.argv[3] || `JSON.stringify({toast:document.querySelector('#toast')?.textContent,modal:document.querySelector('.cs2-modal')?.textContent,page:document.body.dataset.page})`,awaitPromise:true,returnByValue:true}}));
 w.onmessage = e => { console.log(e.data); w.close(); };
})().catch(console.error);
