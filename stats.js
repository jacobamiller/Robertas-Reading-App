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
const top=(o,n)=>Object.keys(o).sort((a,b)=>o[b]-o[a]).slice(0,n);

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
      h+='<div>'+top(tapped,20).map(w=>'<span class="pill">'+esc(w)+' <b>'+tapped[w]+'</b></span>').join("")+'</div>';
    if(Object.keys(looked).length)
      h+='<p class="sub" style="margin-top:12px">Looked up in the word list</p><div>'
        +top(looked,20).map(w=>'<span class="pill">'+esc(w)+' <b>'+looked[w]+'</b></span>').join("")+'</div>';
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
    top(books,20).forEach(b=>{
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
     +top(quits,12).map(k=>'<span class="pill">'+esc(k)+' <b>'+quits[k]+'</b></span>').join("")+'</div>';
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

let SESSIONS=[], EVENTS=[];
Promise.all([Track.sessions(), Track.events()]).then(([s,e])=>{
  SESSIONS=s.sort((a,b)=>a.start-b.start); EVENTS=e;
  $("scope").textContent=SESSIONS.length
    ? SESSIONS.length+" sessions and "+EVENTS.length+" events recorded on this device"
    : "Nothing recorded on this device yet";
  render(SESSIONS, EVENTS);
  $("sendmsg").textContent = Track.endpoint()
    ? "Sending is on. Summaries go out every five minutes and when the app closes."
    : "Sending is off — set ENDPOINT at the top of track.js to collect every child's "
      + "reading in one place. Until then this page only knows about this device.";
}).catch(e=>{
  $("scope").textContent = "Could not read the stored data: " + e;
});
$("csv").onclick=()=>dl("reading-stats.csv", toCSV(SESSIONS.map(Track.summary)),"text/csv");
$("json").onclick=()=>dl("reading-stats.json",
  JSON.stringify({sessions:SESSIONS,events:EVENTS},null,1),"application/json");
$("send").onclick=()=>Track.flush("manual").then(r=>{
  $("sendmsg").textContent = r && r.skipped ? "No endpoint set yet — nothing to send to."
    : "Sent "+((r&&r.sent)||0)+" session summaries.";
});
$("wipe").onclick=()=>{ if(confirm("Erase all reading data on this device?"))
  Track.clear().then(()=>location.reload()); };
