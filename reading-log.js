/* Usage tracking for Roberta's Reading App.
   ------------------------------------------------------------------------
   Everything is written to IndexedDB on the device first, so the app keeps
   working with no network and nothing is ever lost waiting to be sent.
   A rolling summary is posted to an optional endpoint every few minutes,
   when the app is closed, and whenever someone taps Send — see ENDPOINT.
   Leave ENDPOINT empty and the app simply tracks locally.

   The detailed event log never leaves the device. Only the per-session
   summary rows do, which is both less to send and less to look after.      */
(function(global){
"use strict";

/* Where the summaries go.
   ntfy.sh takes a plain POST with no account and no key, and it opens in
   China, which ruled out most of the alternatives. The topic name is the only
   secret there is — anyone who knows it can read the messages and post to it —
   so it is deliberately long and random, and it travels in the link you hand
   each child (?t=<topic>) rather than sitting in this public repo.

   ntfy drops messages after about half a day, so every send carries the
   child's running totals rather than just what is new. The newest message per
   child is always the whole picture, and nothing is lost to expiry.          */
const NTFY = "https://ntfy.sh/";
const FLUSH_MS = 5 * 60 * 1000;   // try to send every five minutes
const DB = "rra", DBV = 1;

let db = null, opening = null, student = null, session = null, flushTimer = null;

/* ---------- storage ---------- */
function open(){
  if(db) return Promise.resolve(db);
  // cache the in-flight promise, not just the handle: two callers arriving
  // together would otherwise both start an open and one would run against a
  // null db
  if(opening) return opening;
  opening = new Promise((res,rej)=>{
    const r = indexedDB.open(DB, DBV);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if(!d.objectStoreNames.contains("events")){
        const s = d.createObjectStore("events",{keyPath:"id",autoIncrement:true});
        s.createIndex("ts","ts"); s.createIndex("student","student");
      }
      if(!d.objectStoreNames.contains("sessions"))
        d.createObjectStore("sessions",{keyPath:"id"});
      if(!d.objectStoreNames.contains("meta"))
        d.createObjectStore("meta",{keyPath:"k"});
    };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror  = () => { opening = null; rej(r.error); };
  });
  return opening;
}
function tx(store, mode){ return db.transaction(store, mode).objectStore(store); }
function put(store, val){
  return open().then(()=>new Promise((res,rej)=>{
    const q = tx(store,"readwrite").put(val);
    q.onsuccess = ()=>res(q.result); q.onerror = ()=>rej(q.error);
  }));
}
function all(store){
  return open().then(()=>new Promise((res,rej)=>{
    const q = tx(store,"readonly").getAll();
    q.onsuccess = ()=>res(q.result||[]); q.onerror = ()=>rej(q.error);
  }));
}
function meta(k, v){
  if(v === undefined)
    return open().then(()=>new Promise(res=>{
      const q = tx("meta","readonly").get(k);
      q.onsuccess = ()=>res(q.result ? q.result.v : null); q.onerror = ()=>res(null);
    }));
  return put("meta",{k:k, v:v});
}

/* ---------- session ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);

/* A visit, not a page load. Moving from the library into a book is the same
   sitting, so the session id rides in sessionStorage and the counters carry
   on rather than starting over — otherwise "sessions" just counts navigations
   and the minutes come out halved. */
function startSession(who){
  student = who || null;
  const prior = resume(who);
  if(prior){
    session = prior;
    if(flushTimer) clearInterval(flushTimer);
    flushTimer = setInterval(()=>flush("timer"), FLUSH_MS);
    drain();
    return session;
  }
  session = {
    id: uid(),
    student: student ? student.code : "?",
    name: student ? student.name : "?",
    start: Date.now(), last: Date.now(),
    book: null, modes: {}, speeds: {},
    pages: 0, sentences: 0, rereads: 0,
    wordTaps: 0, tappedWords: {},
    glossary: 0, glossaryWords: {},
    quizzes: 0, quizRight: 0, quizTotal: 0, quizMissed: [],
    practiceGot: 0, practiceAll: 0,
    booksOpened: {}, lastPage: null, sent: false
  };
  try{ sessionStorage.setItem("sid", session.id); }catch(e){}
  log("session_start", {});
  drain();
  if(flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(()=>flush("timer"), FLUSH_MS);
  return session;
}

let resumed = null;   // filled by preload() before the picker runs
function resume(who){
  let sid = null;
  try{ sid = sessionStorage.getItem("sid"); }catch(e){}
  if(!sid || !resumed || resumed.id !== sid) return null;
  if(who && resumed.student !== who.code) return null;   // a different child
  resumed.last = Date.now();
  return resumed;
}
/* The picker is synchronous once the roster is in, but IndexedDB is not, so
   the session in progress is fetched up front and waiting. */
function preload(){
  let sid = null;
  try{ sid = sessionStorage.getItem("sid"); }catch(e){}
  if(!sid) return Promise.resolve(null);
  return all("sessions").then(list=>{
    resumed = list.find(x=>x.id === sid) || null;
    return resumed;
  }).catch(()=>null);
}

/* Every event lands in the detailed local log and also moves the session
   counters, so the summary is always current without a replay. */
/* The book loads on its own schedule and often beats the "who is reading"
   screen, so anything logged before a session exists is held and replayed
   rather than dropped — otherwise the first book_open and page_view of every
   visit go missing. */
const pending = [];
function log(type, data){
  if(!session){ pending.push([type, data||{}, Date.now()]); return; }
  session.last = Date.now();
  const ev = {ts:Date.now(), student:session.student, session:session.id,
              type:type, data:data||{}};
  put("events", ev).catch(()=>{});
  roll(type, data||{});
  save();
}

function drain(){
  while(pending.length){
    const [t, d, ts] = pending.shift();
    session.last = Math.max(session.last, ts);
    put("events", {ts:ts, student:session.student, session:session.id,
                   type:t, data:d}).catch(()=>{});
    roll(t, d);
  }
  save();
}

function roll(type, d){
  const s = session, bump=(o,k)=>{ if(k!=null) o[k]=(o[k]||0)+1; };
  switch(type){
    case "book_open":
      s.book = d.slug; bump(s.booksOpened, d.slug);
      if(s.booksOpened[d.slug] > 1) s.rereads++;
      break;
    case "page_view":
      // the same page twice running is a replay, not progress
      if(d.slug + "#" + d.page !== s.lastPage){ s.pages++; s.lastPage = d.slug+"#"+d.page; }
      break;
    case "sentence_read": s.sentences++; bump(s.modes,d.mode); bump(s.speeds,String(d.rate)); break;
    case "mode_change":   bump(s.modes, d.mode); break;
    case "speed_change":  bump(s.speeds, String(d.rate)); break;
    case "word_tap":      s.wordTaps++; bump(s.tappedWords, d.word); break;
    case "glossary_word": s.glossary++; bump(s.glossaryWords, d.word); break;
    case "quiz_answer":
      s.quizTotal++; if(d.correct) s.quizRight++;
      else s.quizMissed.push((d.slug||"")+"#"+d.qi);
      break;
    case "quiz_done":     s.quizzes++; break;
    case "practice_result": s.practiceGot += d.got||0; s.practiceAll += d.all||0; break;
  }
}
function save(){ if(session) put("sessions", session).catch(()=>{}); }

/* ---------- sending ---------- */
/* A stable name for this device. One child may read on a laptop, a phone and
   a tablet, and each keeps its own IndexedDB and so its own totals. Messages
   carry this so the teacher's page can hold the newest per device and add
   them up, rather than letting the last device used hide the others.        */
function deviceId(){
  try{
    let d = localStorage.getItem("device");
    if(!d){
      d = (navigator.platform||"dev").replace(/[^A-Za-z]/g,"").slice(0,6).toLowerCase()
          + "-" + Math.random().toString(36).slice(2,7);
      localStorage.setItem("device", d);
    }
    return d;
  }catch(e){ return "unknown"; }
}

function topic(){
  try{
    const fromUrl = new URLSearchParams(location.search).get("t");
    if(fromUrl){ localStorage.setItem("ntfy", fromUrl); return fromUrl; }
    return localStorage.getItem("ntfy") || "";
  }catch(e){ return ""; }
}

const topN = (o,n) => Object.keys(o).sort((a,b)=>o[b]-o[a]).slice(0,n)
                        .map(k=>k+":"+o[k]).join(" ");
const merge = (t,o) => { Object.keys(o||{}).forEach(k=>t[k]=(t[k]||0)+o[k]); return t; };

/* Everything this child has done on this device, not just this sitting. */
function cumulative(list, who){
  const mine = list.filter(s=>s.student === who);
  const t = {student:who, name:(mine[0]||{}).name||who,
             visits:mine.length, minutes:0, pages:0, sentences:0, rereads:0,
             wordTaps:0, glossary:0, quizzes:0, quizRight:0, quizTotal:0,
             practiceGot:0, practiceAll:0,
             books:{}, tapped:{}, lookedUp:{}, modes:{}, speeds:{}, days:{},
             device:deviceId()};
  mine.forEach(s=>{
    t.minutes += (s.last - s.start)/60000;
    ["pages","sentences","rereads","wordTaps","glossary","quizzes",
     "quizRight","quizTotal","practiceGot","practiceAll"].forEach(k=>t[k]+=s[k]||0);
    merge(t.books,s.booksOpened); merge(t.tapped,s.tappedWords);
    merge(t.lookedUp,s.glossaryWords); merge(t.modes,s.modes); merge(t.speeds,s.speeds);
    t.days[new Date(s.start).toISOString().slice(0,10)] = 1;
    if(s.last > (t.lastSeen||0)) t.lastSeen = s.last;
  });
  t.minutes = Math.round(t.minutes*10)/10;
  // the dates themselves, so two devices used on the same day count once
  t.dates = Object.keys(t.days).sort().slice(-120);
  t.days = t.dates.length;
  // ntfy caps a message at 4096 bytes and these grow all term, so keep the
  // long tail out of what is sent — the full log stays on the device
  ["tapped","lookedUp","books","modes","speeds"].forEach(k=>{
    const keep = {}, n = k === "tapped" || k === "lookedUp" ? 25 : 12;
    Object.keys(t[k]).sort((a,b)=>t[k][b]-t[k][a]).slice(0,n)
      .forEach(w=>keep[w]=t[k][w]);
    t[k] = keep;
  });
  return t;
}

/* Readable at a glance in the ntfy web page, and still simple to parse. */
function asText(t){
  const acc = t.practiceAll ? Math.round(t.practiceGot/t.practiceAll*100)+"%" : "-";
  return [
    t.name + " · " + t.device + " · " + new Date().toISOString().slice(0,16).replace("T"," "),
    "minutes " + t.minutes + "  days " + t.days + "  visits " + t.visits +
      "  pages " + t.pages + "  sentences " + t.sentences,
    "accuracy " + acc + "  quiz " + t.quizRight + "/" + t.quizTotal +
      "  rereads " + t.rereads,
    "books " + (topN(t.books,6) || "-"),
    "tapped " + (topN(t.tapped,10) || "-"),
    "lookedup " + (topN(t.lookedUp,10) || "-"),
    "modes " + (topN(t.modes,4) || "-") + "  speeds " + (topN(t.speeds,4) || "-"),
    "json " + JSON.stringify(t)
  ].join("\n");
}
function summary(s){
  return {
    when: new Date(s.start).toISOString(),
    student: s.student, name: s.name,
    minutes: Math.round((s.last - s.start)/6000)/10,
    book: s.book || "",
    booksOpened: Object.keys(s.booksOpened).join(" "),
    rereads: s.rereads,
    pages: s.pages, sentences: s.sentences,
    modes: topN(s.modes,4), speeds: topN(s.speeds,4),
    wordTaps: s.wordTaps, topTapped: topN(s.tappedWords,8),
    glossary: s.glossary, topLookedUp: topN(s.glossaryWords,8),
    quizzes: s.quizzes, quizRight: s.quizRight, quizTotal: s.quizTotal,
    quizMissed: s.quizMissed.join(" "),
    practiceGot: s.practiceGot, practiceAll: s.practiceAll,
    accuracy: s.practiceAll ? Math.round(s.practiceGot/s.practiceAll*100) : ""
  };
}

/* A send is one message holding this child's running totals. It is safe to
   miss one — the next carries everything anyway — so a failure is quietly
   left for next time rather than retried. */
function flush(why, useBeacon){
  const t = topic();
  if(!t) return Promise.resolve({skipped:"no topic set"});
  save();
  return all("sessions").then(list=>{
    const who = session ? session.student : null;
    if(!who) return {skipped:"nobody signed in"};
    const body = asText(cumulative(list, who));
    const url = NTFY + encodeURIComponent(t);
    if(useBeacon && navigator.sendBeacon){
      // text/plain keeps it a simple request, so there is no preflight to answer
      navigator.sendBeacon(url, new Blob([body],{type:"text/plain;charset=utf-8"}));
      return {sent:1, via:"beacon"};
    }
    return fetch(url,{method:"POST",body:body})
      .then(r=>({sent:r.ok?1:0, status:r.status, via:"fetch"}))
      .catch(e=>({error:String(e)}));
  });
}

/* ---------- exports ---------- */
global.Track = {
  start: startSession,
  preload: preload,
  log: log,
  flush: flush,
  session: () => session,
  events: () => all("events"),
  sessions: () => all("sessions"),
  summary: summary,
  meta: meta,
  topic: topic,
  deviceId: deviceId,
  cumulative: cumulative,
  ntfy: NTFY,
  clear: () => open().then(()=>Promise.all(["events","sessions"].map(st=>
            new Promise(res=>{const q=tx(st,"readwrite").clear();q.onsuccess=()=>res();q.onerror=()=>res();}))))
};

// last chance to get the tail of a session off the device
addEventListener("visibilitychange", ()=>{
  if(document.visibilityState === "hidden"){ save(); flush("hide", true); }
});
})(window);
