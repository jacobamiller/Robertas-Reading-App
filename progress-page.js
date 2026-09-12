window.__progressRan = true;
/* The stats page. Kept in its own file rather than inline: some browser
   extensions block inline scripts, and an external file is not treated the
   same way. */
const $=id=>document.getElementById(id);
const esc=t=>String(t).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
const mins=ms=>Math.round(ms/6000)/10;

function tally(list){
  const out={};
  list.forEach(o=>Object.keys(o||{}).forEach(k=>out[k]=(out[k]||0)+o[k]));
  return out;
}
const topKeys=(o,n)=>Object.keys(o).sort((a,b)=>o[b]-o[a]).slice(0,n);

function render(sessions, events){
  if(!sessions.length) return;
  $("empty").remove();
  const byKid={};
  sessions.forEach(s=>{ (byKid[s.student]=byKid[s.student]||[]).push(s); });

  const days=new Set(sessions.map(s=>new Date(s.start).toDateString()));
  const total=sessions.reduce((a,s)=>a+(s.last-s.start),0);
  const got=sessions.reduce((a,s)=>a+s.practiceGot,0);
  const all=sessions.reduce((a,s)=>a+s.practiceAll,0);
  let h='<div class="cards">'
    +card(Object.keys(byKid).length,"readers")
    +card(sessions.length,"sessions")
    +card(mins(total)+"m","time reading")
    +card(days.size,"days used")
    +card(sessions.reduce((a,s)=>a+s.pages,0),"pages")
    +card(all?Math.round(got/all*100)+"%":"—","words read clearly")
    +'</div>';

  // per child
  h+='<h2>Each reader</h2><table><tr><th>Reader</th><th class="n">Sessions</th>'
   +'<th class="n">Minutes</th><th class="n">Pages</th><th class="n">Accuracy</th>'
   +'<th class="n">Quiz</th><th>Last read</th></tr>';
  Object.keys(byKid).forEach(code=>{
    const ss=byKid[code], g=ss.reduce((a,s)=>a+s.practiceGot,0), n=ss.reduce((a,s)=>a+s.practiceAll,0);
    const qr=ss.reduce((a,s)=>a+s.quizRight,0), qt=ss.reduce((a,s)=>a+s.quizTotal,0);
    const last=Math.max(...ss.map(s=>s.last));
    h+='<tr><td><b>'+esc(ss[0].name)+'</b></td>'
      +'<td class="n">'+ss.length+'</td>'
      +'<td class="n">'+mins(ss.reduce((a,s)=>a+(s.last-s.start),0))+'</td>'
      +'<td class="n">'+ss.reduce((a,s)=>a+s.pages,0)+'</td>'
      +'<td class="n">'+(n?Math.round(g/n*100)+"%":"—")+'</td>'
      +'<td class="n">'+(qt?qr+"/"+qt:"—")+'</td>'
      +'<td>'+new Date(last).toLocaleDateString()+'</td></tr>';
  });
  h+='</table>';

  // words tapped — the ones they did not know
  const tapped=tally(sessions.map(s=>s.tappedWords));
  const looked=tally(sessions.map(s=>s.glossaryWords));
  if(Object.keys(tapped).length||Object.keys(looked).length){
    h+='<h2>Words they stopped on</h2><p class="sub">Tapping a word means it was not '
     +'known at a glance. The most-tapped words are the vocabulary to work on.</p>';
    if(Object.keys(tapped).length)
      h+='<div>'+topKeys(tapped,20).map(w=>'<span class="pill">'+esc(w)+' <b>'+tapped[w]+'</b></span>').join("")+'</div>';
    if(Object.keys(looked).length)
      h+='<p class="sub" style="margin-top:12px">Looked up in the word list</p><div>'
        +topKeys(looked,20).map(w=>'<span class="pill">'+esc(w)+' <b>'+looked[w]+'</b></span>').join("")+'</div>';
  }

  // how they read
  const modes=tally(sessions.map(s=>s.modes)), speeds=tally(sessions.map(s=>s.speeds));
  const LAB={"0.4":"Very slow","0.7":"Slow","1":"Normal","1.35":"Fast"};
  h+='<h2>How they read</h2><div class="cards">';
  const mt=Object.values(modes).reduce((a,b)=>a+b,0)||1;
  Object.keys(modes).forEach(m=>{ h+=card(Math.round(modes[m]/mt*100)+"%",
      ({listen:"Read to me",echo:"My turn",practice:"Scored"}[m]||m)); });
  h+='</div><div class="cards" style="margin-top:10px">';
  const st=Object.values(speeds).reduce((a,b)=>a+b,0)||1;
  Object.keys(speeds).sort((a,b)=>a-b).forEach(r=>{
    h+=card(Math.round(speeds[r]/st*100)+"%", LAB[r]||r); });
  h+='</div>';

  // books, and whether they came back to one
  const books=tally(sessions.map(s=>s.booksOpened));
  if(Object.keys(books).length){
    h+='<h2>Books</h2><p class="sub">Opening a book again is the clearest sign a '
     +'child liked it.</p><table><tr><th>Book</th><th class="n">Opened</th><th></th></tr>';
    const mx=Math.max(...Object.values(books));
    topKeys(books,20).forEach(b=>{
      h+='<tr><td>'+esc(b)+'</td><td class="n">'+books[b]+'</td>'
        +'<td><span class="bar" style="width:'+(books[b]/mx*160)+'px"></span></td></tr>';
    });
    h+='</table>';
  }

  // where they stopped
  const quits={};
  sessions.forEach(s=>{ if(s.lastPage) quits[s.lastPage]=(quits[s.lastPage]||0)+1; });
  if(Object.keys(quits).length){
    h+='<h2>Where reading stopped</h2><p class="sub">The page a session ended on. '
     +'The same page over and over is usually where a book gets too hard, or too dull.</p><div>'
     +topKeys(quits,12).map(k=>'<span class="pill">'+esc(k)+' <b>'+quits[k]+'</b></span>').join("")+'</div>';
  }
  $("out").innerHTML=h;
}
const card=(big,small)=>'<div class="card"><b>'+big+'</b><span>'+small+'</span></div>';

function dl(name, text, type){
  const b=new Blob([text],{type:type}), u=URL.createObjectURL(b);
  const a=document.createElement("a"); a.href=u; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(u),4000);
}
function toCSV(rows){
  if(!rows.length) return "";
  const cols=Object.keys(rows[0]);
  const q=v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"';
  return cols.join(",")+"\n"+rows.map(r=>cols.map(c=>q(r[c])).join(",")).join("\n");
}

/* Everyone, pulled back off ntfy. Each child's newest message holds their
   running totals, so the latest one per child is the whole picture. Messages
   expire after about half a day, but a child who has opened the app since
   then has already replaced theirs. */
async function fromNtfy(){
  const t = Track.topic();
  if(!t) return null;
  const r = await fetch(Track.ntfy + encodeURIComponent(t) + "/json?poll=1");
  if(!r.ok) throw new Error("ntfy said " + r.status);
  const txt = (await r.text()).trim();
  if(!txt) return [];
  const latest = {};
  txt.split("\n").forEach(line=>{
    let m; try{ m = JSON.parse(line); }catch(e){ return; }
    const body = m.message || "";
    const j = body.split("\n").find(l=>l.indexOf("json ") === 0);
    if(!j) return;
    let t2; try{ t2 = JSON.parse(j.slice(5)); }catch(e){ return; }
    if(!latest[t2.student] || (m.time||0) > latest[t2.student]._at)
      { t2._at = m.time||0; latest[t2.student] = t2; }
  });
  return Object.values(latest);
}

function renderEveryone(rows){
  if(!rows.length) return '<p class="sub">Nothing has arrived yet.</p>';
  rows.sort((a,b)=>b.minutes-a.minutes);
  let h='<table><tr><th>Reader</th><th class="n">Minutes</th><th class="n">Days</th>'
   +'<th class="n">Pages</th><th class="n">Accuracy</th><th class="n">Quiz</th>'
   +'<th class="n">Re-reads</th><th>Last seen</th></tr>';
  rows.forEach(t=>{
    const acc = t.practiceAll ? Math.round(t.practiceGot/t.practiceAll*100)+"%" : "—";
    h+='<tr><td><b>'+esc(t.name)+'</b></td><td class="n">'+t.minutes+'</td>'
      +'<td class="n">'+t.days+'</td><td class="n">'+t.pages+'</td>'
      +'<td class="n">'+acc+'</td>'
      +'<td class="n">'+(t.quizTotal?t.quizRight+"/"+t.quizTotal:"—")+'</td>'
      +'<td class="n">'+t.rereads+'</td>'
      +'<td>'+(t.lastSeen?new Date(t.lastSeen).toLocaleDateString():"—")+'</td></tr>';
  });
  h+='</table>';
  const all={}, look={};
  rows.forEach(t=>{ Object.keys(t.tapped||{}).forEach(w=>all[w]=(all[w]||0)+t.tapped[w]);
                    Object.keys(t.lookedUp||{}).forEach(w=>look[w]=(look[w]||0)+t.lookedUp[w]); });
  if(Object.keys(all).length)
    h+='<h2>Words the group stopped on</h2><div>'
      +topKeys(all,24).map(w=>'<span class="pill">'+esc(w)+' <b>'+all[w]+'</b></span>').join("")+'</div>';
  if(Object.keys(look).length)
    h+='<h2>Looked up in the word list</h2><div>'
      +topKeys(look,24).map(w=>'<span class="pill">'+esc(w)+' <b>'+look[w]+'</b></span>').join("")+'</div>';
  return h;
}

let SESSIONS=[], EVENTS=[], EVERYONE=[];
Promise.all([Track.sessions(), Track.events()]).then(([s,e])=>{
  SESSIONS=s.sort((a,b)=>a.start-b.start); EVENTS=e;
  $("scope").textContent=SESSIONS.length
    ? SESSIONS.length+" sessions and "+EVENTS.length+" events recorded on this device"
    : "Nothing recorded on this device yet";
  render(SESSIONS, EVENTS);
  $("sendmsg").textContent = Track.topic()
    ? "Sending is on, to ntfy topic " + Track.topic() + "."
    : "No topic set on this device. Open this page with ?t=<topic> once to set it.";
}).catch(e=>{
  $("scope").textContent = "Could not read the stored data: " + e;
});
(async ()=>{
  const host=document.createElement("div");
  $("out").parentNode.insertBefore(host,$("out"));
  if(!Track.topic()){
    host.innerHTML='<h2>Everyone</h2><p class="sub">No ntfy topic set on this device, '
      +'so only this device is shown below. Open this page once with '
      +'<code>?t=&lt;topic&gt;</code> to connect it.</p>';
    return;
  }
  host.innerHTML='<h2>Everyone</h2><p class="sub">Loading…</p>';
  try{
    EVERYONE = await fromNtfy() || [];
    host.innerHTML='<h2>Everyone</h2><p class="sub">'+EVERYONE.length
      +' reader(s) reporting to topic <code>'+esc(Track.topic())+'</code></p>'
      +renderEveryone(EVERYONE)
      +'<p class="sub" style="margin-top:10px">Below is only this device.</p>';
  }catch(e){
    host.innerHTML='<h2>Everyone</h2><p class="sub">Could not reach ntfy: '+esc(e.message)+'</p>';
  }
})();

$("csv").onclick=()=>dl("reading-stats.csv", toCSV(SESSIONS.map(Track.summary)),"text/csv");
$("json").onclick=()=>dl("reading-stats.json",
  JSON.stringify({everyone:EVERYONE,sessions:SESSIONS,events:EVENTS},null,1),"application/json");
const grpBtn=document.createElement("button");
grpBtn.textContent="Download everyone (CSV)";
grpBtn.onclick=()=>dl("everyone.csv", toCSV(EVERYONE.map(t=>({
  name:t.name, student:t.student, minutes:t.minutes, days:t.days, visits:t.visits,
  pages:t.pages, sentences:t.sentences, rereads:t.rereads, wordTaps:t.wordTaps,
  glossary:t.glossary, quizRight:t.quizRight, quizTotal:t.quizTotal,
  accuracy:t.practiceAll?Math.round(t.practiceGot/t.practiceAll*100):"",
  topTapped:topKeys(t.tapped||{},10).join(" "),
  books:topKeys(t.books||{},6).join(" "),
  lastSeen:t.lastSeen?new Date(t.lastSeen).toISOString():""
}))),"text/csv");
$("csv").parentNode.insertBefore(grpBtn,$("csv"));
$("send").onclick=()=>Track.flush("manual").then(r=>{
  $("sendmsg").textContent = r && r.skipped ? "No endpoint set yet — nothing to send to."
    : "Sent "+((r&&r.sent)||0)+" session summaries.";
});
$("wipe").onclick=()=>{ if(confirm("Erase all reading data on this device?"))
  Track.clear().then(()=>location.reload()); };
