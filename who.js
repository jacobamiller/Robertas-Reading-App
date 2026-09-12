/* Who is reading.
   ------------------------------------------------------------------------
   A small roster in students.json, a tap to pick a name, and a four digit
   PIN. Land on ?s=<code> and that child is preselected, so a teacher can
   hand each student their own link and they only ever tap the PIN.

   Be clear-eyed about the PIN: it stops a sibling poking at someone else's
   reading, and that is all it stops. The check runs on the device and the
   roster is public, so four digits is a speed bump, not a lock. Storing the
   hash rather than the number just keeps it from being readable at a glance.
   If this ever grows past a handful of children, it needs real accounts.    */
(function(global){
"use strict";

const KEY = "who", ROSTER = "students.json";
let roster = [], current = null;

const $ = id => document.getElementById(id);

/* SHA-256, for when crypto.subtle is missing. It is absent on plain http —
   a phone opening the app over a LAN address gets no Web Crypto at all — and
   the PIN check has to work there too. */
function sha256(str){
  const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  // UTF-8 bytes
  const b=[]; for(const ch of unescape(encodeURIComponent(str))) b.push(ch.charCodeAt(0));
  const bits=b.length*8;
  b.push(0x80); while(b.length%64!==56) b.push(0);
  for(let i=7;i>=0;i--) b.push((bits/Math.pow(2,i*8))&0xff);
  const rr=(x,n)=>(x>>>n)|(x<<(32-n));
  for(let i=0;i<b.length;i+=64){
    const w=new Array(64);
    for(let t=0;t<16;t++) w[t]=(b[i+t*4]<<24)|(b[i+t*4+1]<<16)|(b[i+t*4+2]<<8)|b[i+t*4+3];
    for(let t=16;t<64;t++){
      const s0=rr(w[t-15],7)^rr(w[t-15],18)^(w[t-15]>>>3);
      const s1=rr(w[t-2],17)^rr(w[t-2],19)^(w[t-2]>>>10);
      w[t]=(w[t-16]+s0+w[t-7]+s1)|0;
    }
    let [a,c,d,e,f,g,h,l]=H;
    for(let t=0;t<64;t++){
      const S1=rr(f,6)^rr(f,11)^rr(f,25), ch=(f&g)^(~f&h);
      const t1=(l+S1+ch+K[t]+w[t])|0;
      const S0=rr(a,2)^rr(a,13)^rr(a,22), mj=(a&c)^(a&d)^(c&d);
      const t2=(S0+mj)|0;
      l=h; h=g; g=f; f=(e+t1)|0; e=d; d=c; c=a; a=(t1+t2)|0;
    }
    H=[H[0]+a,H[1]+c,H[2]+d,H[3]+e,H[4]+f,H[5]+g,H[6]+h,H[7]+l].map(x=>x|0);
  }
  return H.map(x=>((x>>>0).toString(16).padStart(8,"0"))).join("");
}

async function sha(text){
  // Web Crypto is only there in a secure context, so a phone opening this over
  // a plain http LAN address has none. Same answer either way.
  if(global.crypto && crypto.subtle){
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");
  }
  return sha256(text);
}
// salted with the code so two children sharing a PIN do not share a hash
const pinHash = (code, pin) => sha(code + ":" + pin);

function css(){
  if($("whocss")) return;
  const s = document.createElement("style"); s.id="whocss";
  s.textContent = `
  #whoWrap{position:fixed;inset:0;z-index:9999;background:#FFFDF7;display:flex;
    flex-direction:column;align-items:center;justify-content:center;padding:26px;
    font-family:ui-rounded,"SF Pro Rounded","Avenir Next",system-ui,sans-serif}
  #whoWrap h2{font-size:21px;margin:0 0 4px;color:#1E1B18}
  #whoWrap p{color:#8d8780;font-size:14px;margin:0 0 22px;text-align:center}
  .whoGrid{display:flex;flex-wrap:wrap;gap:13px;justify-content:center;max-width:420px}
  .whoBtn{background:#fff;border:2px solid #E4DED2;border-radius:18px;padding:15px 10px;
    width:104px;font:inherit;font-size:15px;color:#1E1B18;cursor:pointer}
  .whoBtn:active{background:#F0EAE0}
  .whoAv{font-size:32px;display:block;margin-bottom:5px}
  .whoPin{display:flex;gap:9px;margin:6px 0 4px}
  .whoDot{width:15px;height:15px;border-radius:50%;border:2px solid #A9A29A}
  .whoDot.on{background:#4E9A3E;border-color:#4E9A3E}
  .whoKeys{display:grid;grid-template-columns:repeat(3,72px);gap:11px;margin-top:16px}
  .whoKeys button{font:inherit;font-size:22px;padding:14px 0;border-radius:14px;
    border:2px solid #E4DED2;background:#fff;cursor:pointer}
  .whoKeys button:active{background:#F0EAE0}
  #whoErr{color:#D93A2B;font-size:14px;min-height:20px;margin-top:12px}
  #whoBack{margin-top:16px;background:none;border:0;color:#2C6FB5;font:inherit;
    font-size:15px;text-decoration:underline;cursor:pointer}`;
  document.head.appendChild(s);
}

function screen(){
  css();
  let w = $("whoWrap");
  if(!w){ w = document.createElement("div"); w.id="whoWrap"; document.body.appendChild(w); }
  return w;
}

function pick(){
  const w = screen();
  w.innerHTML = "<h2>Who is reading?</h2><p>Tap your name</p>";
  const g = document.createElement("div"); g.className="whoGrid";
  roster.forEach(st=>{
    const b = document.createElement("button"); b.className="whoBtn";
    b.innerHTML = '<span class="whoAv">'+(st.avatar||"🙂")+'</span>'+st.name;
    b.onclick = ()=>askPin(st);
    g.appendChild(b);
  });
  w.appendChild(g);
}

function askPin(st){
  const w = screen();
  w.innerHTML = '<h2>'+(st.avatar||"🙂")+' '+st.name+'</h2><p>Type your four numbers</p>';
  const dots = document.createElement("div"); dots.className="whoPin";
  const d = [0,1,2,3].map(()=>{const e=document.createElement("div");e.className="whoDot";dots.appendChild(e);return e;});
  w.appendChild(dots);
  const err = document.createElement("div"); err.id="whoErr"; w.appendChild(err);
  const keys = document.createElement("div"); keys.className="whoKeys";
  let buf = "";
  const draw = ()=>d.forEach((e,i)=>e.classList.toggle("on", i<buf.length));
  const tap = async n=>{
    if(n === "x"){ buf = buf.slice(0,-1); draw(); return; }
    if(buf.length >= 4) return;
    buf += n; draw();
    if(buf.length < 4) return;
    let h = null;
    try{ h = await pinHash(st.code, buf); }
    catch(e){ err.textContent = "Could not check that number here (" + e.message + ")"; buf=""; draw(); return; }
    if(h === st.pin){ enter(st); return; }
    err.textContent = "That is not the right number — try again";
    buf = ""; setTimeout(draw, 260);
  };
  ["1","2","3","4","5","6","7","8","9"].forEach(n=>{
    const b=document.createElement("button"); b.textContent=n; b.onclick=()=>tap(n); keys.appendChild(b);
  });
  const blank=document.createElement("span"); keys.appendChild(blank);
  const zero=document.createElement("button"); zero.textContent="0"; zero.onclick=()=>tap("0"); keys.appendChild(zero);
  const del=document.createElement("button"); del.textContent="⌫"; del.onclick=()=>tap("x"); keys.appendChild(del);
  w.appendChild(keys);
  const back=document.createElement("button"); back.id="whoBack"; back.textContent="not me";
  back.onclick=pick; w.appendChild(back);
}

function enter(st){
  current = st;
  try{ sessionStorage.setItem(KEY, st.code); }catch(e){}
  const w = $("whoWrap"); if(w) w.remove();
  if(global.Track) Track.start(st);
  document.dispatchEvent(new CustomEvent("who", {detail:st}));
}

async function init(){
  // let any session already in progress load before a name is chosen
  if(global.Track && Track.preload){ try{ await Track.preload(); }catch(e){} }
  try{
    const r = await fetch(ROSTER, {cache:"no-cache"});
    roster = (await r.json()).students || [];
  }catch(e){ roster = []; }
  if(!roster.length){                       // no roster: track anonymously
    if(global.Track) Track.start({code:"anon", name:"anon"});
    document.dispatchEvent(new CustomEvent("who",{detail:null}));
    return;
  }
  // a name already chosen this visit does not need asking again
  let code = null;
  try{ code = sessionStorage.getItem(KEY); }catch(e){}
  const urlCode = new URLSearchParams(location.search).get("s");
  const known = roster.find(s=>s.code === code);
  if(known){ enter(known); return; }
  const hinted = roster.find(s=>s.code === urlCode);
  if(hinted){ askPin(hinted); return; }
  pick();
}

global.Who = { init: init, current: ()=>current, roster: ()=>roster,
               pinHash: pinHash, signOut: ()=>{ try{sessionStorage.removeItem(KEY)}catch(e){} } };
})(window);
