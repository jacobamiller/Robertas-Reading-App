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

const ENDPOINT = "";              // set to a Google Apps Script web app URL
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

function startSession(who){
  student = who || null;
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
  log("session_start", {});
  if(flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(()=>flush("timer"), FLUSH_MS);
  return session;
}

/* Every event lands in the detailed local log and also moves the session
   counters, so the summary is always current without a replay. */
function log(type, data){
  if(!session) return;
  session.last = Date.now();
  const ev = {ts:Date.now(), student:session.student, session:session.id,
              type:type, data:data||{}};
  put("events", ev).catch(()=>{});
  roll(type, data||{});
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
const topN = (o,n) => Object.keys(o).sort((a,b)=>o[b]-o[a]).slice(0,n)
                        .map(k=>k+":"+o[k]).join(" ");
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

/* Unsent sessions queue up, so a phone that was offline catches up later
   rather than losing the day. */
function flush(why, useBeacon){
  if(!ENDPOINT) return Promise.resolve({skipped:"no endpoint"});
  save();
  return all("sessions").then(list=>{
    const due = list.filter(s => !s.sent && (s.id !== (session&&session.id) || why !== "timer" || true));
    if(!due.length) return {sent:0};
    const body = JSON.stringify({v:1, why:why, rows: due.map(summary)});
    // text/plain dodges the CORS preflight that Apps Script will not answer
    if(useBeacon && navigator.sendBeacon){
      navigator.sendBeacon(ENDPOINT, new Blob([body],{type:"text/plain;charset=utf-8"}));
      return mark(due).then(()=>({sent:due.length, via:"beacon"}));
    }
    return fetch(ENDPOINT,{method:"POST",mode:"no-cors",
                           headers:{"Content-Type":"text/plain;charset=utf-8"},body:body})
      .then(()=>mark(due)).then(()=>({sent:due.length, via:"fetch"}))
      .catch(e=>({error:String(e)}));   // stays unsent, tried again next time
  });
}
function mark(rows){
  // the live session is never closed off, so it keeps updating and resends
  return Promise.all(rows.filter(r=>r.id!==(session&&session.id))
                         .map(r=>put("sessions",Object.assign({},r,{sent:true}))));
}

/* ---------- exports ---------- */
global.Track = {
  start: startSession,
  log: log,
  flush: flush,
  session: () => session,
  events: () => all("events"),
  sessions: () => all("sessions"),
  summary: summary,
  meta: meta,
  endpoint: () => ENDPOINT,
  clear: () => open().then(()=>Promise.all(["events","sessions"].map(st=>
            new Promise(res=>{const q=tx(st,"readwrite").clear();q.onsuccess=()=>res();q.onerror=()=>res();}))))
};

// last chance to get the tail of a session off the device
addEventListener("visibilitychange", ()=>{
  if(document.visibilityState === "hidden"){ save(); flush("hide", true); }
});
})(window);
