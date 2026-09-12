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

async function sha(text){
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");
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
    const h = await pinHash(st.code, buf);
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
