import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const data = await Bun.file(root + "output/departure-research.json").json();
const embedded = JSON.stringify(data).replaceAll("<", "\\u003c");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pocket Flight — departure evidence</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f6f4;color:#202c31;font:16px/1.55 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:36px 28px 70px}h1{font-size:34px;line-height:1.15;margin:10px 0 16px}h2{font-size:23px;margin:30px 0 12px}p{max-width:940px}small,.muted{color:#59676c}.status{font-size:12px;letter-spacing:.12em;font-weight:700}.panel{padding:22px;background:white;border:1px solid #d5dedb;border-radius:8px;margin:20px 0}.controls{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}label{font-size:13px;font-weight:600}select{display:block;width:100%;padding:10px;border:1px solid #b7c4c0;background:white;border-radius:4px;color:inherit;font:inherit;margin-top:5px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:22px}.metric strong{display:block;font-size:23px}.metric span{font-size:12px;color:#59676c}svg{width:100%;height:auto;display:block}svg text{font-family:system-ui;font-size:12px;fill:#59676c}.legend{display:flex;gap:20px;flex-wrap:wrap;font-size:13px;margin:12px 0}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:10px 8px;border-bottom:1px solid #dee4e1}th{font-size:12px;color:#59676c}.table-wrap{overflow:auto}.note{border-left:3px solid #bb603b;padding-left:14px}.failure{color:#9d4022}.ok{color:#246b56}a{color:#186755}details{margin-top:20px}pre{font-size:11px;overflow:auto}li{margin:8px 0}.foot{font-size:13px;margin-top:30px}@media(max-width:700px){main{padding:22px 15px}.controls,.metrics{grid-template-columns:repeat(2,1fr)}h1{font-size:28px}}
</style></head><body><main>
<div class="status">PRIVATE / LOCAL · RESEARCH ONLY · NO DEPLOYMENT</div>
<h1>Why the mountain departure fails</h1>
<p>Measured with the current flight model and original north-facing Palm Bay departure. Aircraft mass, engine ratings, runway direction and terrain are unchanged for these experiments.</p>
<p id="finding" class="note"></p>
<section class="panel">
<div class="controls"><label>Aircraft<select id="aircraft"><option value="finch">Finch U–2</option><option value="peregrine">Peregrine HX–27</option><option value="aurelia">Aurelia S32</option><option value="stormbird">Stormbird HX–40</option></select></label>
<label>Loading<select id="load"><option>default</option><option>zero payload</option><option>half default fuel</option></select></label>
<label>Control experiment<select id="mode"><option>full pull</option><option>gentle pull</option><option>10° attitude</option><option>climb-speed control</option></select></label>
<label>Wind<select id="wind"><option>game gusts</option><option>calm</option></select></label></div>
<div id="metrics" class="metrics"></div><p id="description" class="muted"></p>
<div class="legend"><span><i class="dot" style="background:#246b56"></i>Aircraft origin altitude</span><span><i class="dot" style="background:#9a9f90"></i>Ground below aircraft</span><span>Dashed: centerline terrain ahead</span><span><i class="dot" style="background:#c55730"></i>Last state before impact</span></div>
<svg id="path" viewBox="0 0 1000 330" role="img" aria-label="Flight altitude and terrain along northward departure"></svg>
<div class="legend"><span><i class="dot" style="background:#2e6c9d"></i>True airspeed</span><span><i class="dot" style="background:#b46937"></i>Computed stall speed</span></div>
<svg id="speed" viewBox="0 0 1000 230" role="img" aria-label="True airspeed and stall-speed reference"></svg>
<p class="muted">Distance is northward progress from the spawn, not total curved path length. Ground follows the measured aircraft position. Altitude is the model origin, not the bottom of its wheels or nose. Traces end at the first damage; collision-altered speed is excluded from the plots.</p>
</section>
<h2>All four aircraft: identical default input</h2>
<p>Full throttle, rotate at each aircraft’s declared rotation speed, hold full pull, beginner assist on, automatic configuration, normal game gusts, 60 Hz. “Past ridge” means northward z ≤ −700 without any damage; “game ceiling” stops at 1,799 m.</p>
<div class="table-wrap"><table><thead><tr><th>Aircraft</th><th>Mass</th><th>Liftoff time / roll</th><th>Result</th><th>Pre-impact / end state</th></tr></thead><tbody id="fleet"></tbody></table></div>
<h2>Does removing weight solve Finch’s departure?</h2>
<div class="table-wrap"><table><thead><tr><th>Loading</th><th>Mass</th><th>Fuel</th><th>Full-pull result</th><th>Altitude / speed / climb</th></tr></thead><tbody id="weight"></tbody></table></div>
<p>“Zero payload” removes every part tagged as payload, including crew where tagged. This deliberately isolates mass and balance effects; it is not a recommended piloted aircraft configuration. Half default fuel keeps the normal payload and halves the initial fuel fraction.</p>
<h2>Terrain demand and frame-rate repeatability</h2><p id="terrain"></p>
<div class="table-wrap"><table><thead><tr><th>Finch frame rate</th><th>First-damage time</th><th>Pre-impact altitude</th><th>Pre-impact speed</th><th>Damaged part</th></tr></thead><tbody id="repeat"></tbody></table></div>
<p id="gates"></p>
<h2>Real data: reference ranges, not borrowed aircraft identities</h2>
<div class="table-wrap"><table><thead><tr><th>Reference</th><th>Published conditions and figures</th><th>What it tells us</th></tr></thead><tbody>
<tr><td><a href="https://www.diamondaircraft.com/en/private-owners/aircraft/da40/tech-specs/">Diamond DA40 XLT</a></td><td>180 hp; MTOM 1,200 kg. MTOM / ISA sea level: climb 4.0 m/s, ground roll 305 m, takeoff obstacle distance 450 m.</td><td>Trainer performance is strongly dependent on loading and configuration. Finch has similar engine power but different mass, wing and propeller; copying this climb rate would be unjustified.</td></tr>
<tr><td><a href="https://txtav.com/CJ4-Gen2">Citation CJ4 Gen3</a></td><td>MTOW 7,761 kg; two 16.11 kN engines; listed maximum climb 1,175 m/min; takeoff field length 1,039 m. Current Gen3 page uses a legacy Gen2 URL.</td><td>Aurelia’s 50 kN concept rating at about 5.66 tonnes is already generous relative to this analogue. Palm Bay’s 470 m runway is much shorter than its listed field length. Figures are not matched-condition equivalents.</td></tr>
<tr><td><a href="https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook/05_afh_ch4.pdf">FAA Airplane Flying Handbook, Chapter 4</a></td><td>Excess power, airspeed and pitch jointly determine climb. Vx is best climb angle; Vy is best climb rate.</td><td>Raising the nose alone does not establish obstacle clearance. A sustainable climb-speed schedule and an escape route need separate checks.</td></tr>
</tbody></table></div>
<h2>Model-only excess-power estimates</h2>
<div class="table-wrap"><table><thead><tr><th>Aircraft / loading</th><th>Best estimated rate</th><th>Speed at that rate</th><th>Best estimated gradient</th></tr></thead><tbody id="power"></tbody></table></div>
<p class="note">These are small-angle estimates from level-trim thrust surplus at 100 m, full power, fixed Finch gear or retracted jet gear, zero flaps. They are not measured sustained climbs and become unreliable at the very large gradients produced by the jet concepts. They exclude the game’s high-speed and ceiling protections. They establish neither real Vx / Vy nor a flight certification.</p>
<h2>Conclusions before changing the game</h2>
<ol><li>Extend departure acceptance beyond the current 20-second check and test terrain clearance through the complete exit route.</li><li>Separate the straight-ahead mountain route from the intended coastal turn. Confirm the turn with normal controls in the local browser before changing the runway or terrain.</li><li>Investigate beginner assist’s climb scheduling and attitude limits with instrumented tests. The 1.5× stall-speed controller here is a diagnostic experiment, not a final fix.</li><li>Keep mass and engine changes aircraft-specific and source-grounded. Passing these terrain-only traces does not validate the fleet’s real-world performance.</li></ol>
<h2>Method and limits</h2><p id="method"></p><ul id="limits"></ul>
<details><summary>Reproduction and source fingerprints</summary><p>Run <code>bun run departure:measure</code>, then <code>bun scripts/report-departure-research.ts</code>. The JSON includes quarter-second traces, liftoff, gate crossings, last pre-impact state, first impact events, fuel / CG, frame rate and source hashes.</p><pre id="hashes"></pre></details>
<p class="foot" id="generated"></p>
</main><script>
const d=${embedded};
const names={finch:'Finch U–2',peregrine:'Peregrine HX–27',aurelia:'Aurelia S32',stormbird:'Stormbird HX–40'};
const el=id=>document.getElementById(id), f=(v,n=1)=>Number(v).toFixed(n), endpoint=r=>r.damage?r.damage.before:r.samples.at(-1), contact=r=>[...new Set(r.damage.events.map(e=>e.part||e.type))].join(', ');
const defaults=d.runs.filter(r=>r.hz===60&&r.load==='default'&&r.mode==='full pull'&&r.wind==='game gusts');
const finch=defaults.find(r=>r.id==='finch'), pre=endpoint(finch);
el('finding').textContent='Finch lifts off at '+f(finch.liftoff.time,2)+' s, then strikes rising terrain at '+f(finch.damage.after.time,2)+' s while holding full pull. The other three default full-pull cases finish their measured departures without damage. This confirms a Finch departure problem; it does not support reducing every aircraft’s weight.';
el('fleet').innerHTML=defaults.map(r=>{const e=endpoint(r);return '<tr><td>'+names[r.id]+'</td><td>'+f(r.initial.mass)+' kg</td><td>'+f(r.liftoff.time,2)+' s / '+f(459-r.liftoff.z)+' m</td><td class="'+(r.damage?'failure':'ok')+'">'+r.outcome+'</td><td>'+f(e.time,2)+' s · '+f(e.y)+' m · '+f(e.knots)+' kt</td></tr>'}).join('');
el('weight').innerHTML=d.runs.filter(r=>r.id==='finch'&&r.hz===60&&r.mode==='full pull'&&r.wind==='game gusts').map(r=>{const e=endpoint(r);return '<tr><td>'+r.load+'</td><td>'+f(r.initial.mass)+' kg</td><td>'+f(r.initial.fuelKg)+' kg</td><td>'+r.outcome+' at '+f(r.damage?r.damage.after.time:e.time,2)+' s</td><td>'+f(e.y)+' m / '+f(e.knots)+' kt / '+f(e.verticalSpeed)+' m/s</td></tr>'}).join('');
const peak=d.terrain.reduce((a,b)=>a.height>b.height?a:b), threshold=d.terrain.reduce((a,b)=>Math.abs(a.z-25)<Math.abs(b.z-25)?a:b);
const gradient=Math.max(...d.terrain.filter(t=>t.z<=25).map(t=>(t.height+10-finch.liftoff.y)/(finch.liftoff.z-t.z)));
el('terrain').textContent='At x = −260 m, north-threshold ground is approximately '+f(threshold.height)+' m. The centerline terrain peaks at '+f(peak.height)+' m near z = '+f(peak.z,0)+' m. A hypothetical straight line from Finch’s measured liftoff origin, maintaining a chosen 10 m terrain margin beyond the north threshold, requires at least '+f(gradient*100)+'% gradient ('+f(Math.atan(gradient)*180/Math.PI)+'°). This diagnostic line ignores turn opportunities, body size and changing performance; the margin is not a regulatory criterion.';
el('repeat').innerHTML=d.runs.filter(r=>r.id==='finch'&&r.load==='default'&&r.mode==='full pull'&&r.wind==='game gusts').sort((a,b)=>a.hz-b.hz).map(r=>{const e=endpoint(r);return '<tr><td>'+r.hz+' Hz</td><td>'+f(r.damage.after.time,3)+' s</td><td>'+f(e.y,2)+' m</td><td>'+f(e.knots,2)+' kt</td><td>'+contact(r)+'</td></tr>'}).join('');
el('gates').textContent='First Light’s original route goes from (−260, 50, 130) to (−465, 95, −30), then (−700, 110, −230): it turns west rather than climbing straight over the ridge. The measured full-pull Finch reaches the first gate’s z at '+f(finch.gate.y)+' m. The route itself still needs a controlled browser flight.';
el('power').innerHTML=d.estimates.filter(e=>e.load==='default').map(e=>'<tr><td>'+names[e.id]+' / default</td><td>'+(e.id==='finch'?f(e.bestRate.rate)+' m/s':'Outside small-angle approximation')+'</td><td>'+(e.id==='finch'?f(e.bestRate.speed*1.943844)+' kt':'—')+'</td><td>'+(e.id==='finch'?f(e.bestGradient.gradient*100)+'% (approximate)':'—')+'</td></tr>').join('');
el('method').textContent=d.method+' '+d.runs.length+' cases recorded.';
el('limits').innerHTML=d.limitations.map(s=>'<li>'+s+'</li>').join('');
el('hashes').textContent=JSON.stringify(d.hashes,null,2);el('generated').textContent='Generated '+d.generatedAt+' · Shared flight engine, offline instrumented harness. No browser flight, real-aircraft certification or production update is implied.';
function chart(id,r,series,height,label){
 const width=1000,left=64,right=22,top=18,bottom=43,span=width-left-right,plotH=height-top-bottom;
 const rows=r.samples, xmax=Math.max(1159,...rows.map(s=>459-s.z)),ymax=Math.max(20,...rows.flatMap(s=>series.map(v=>s[v.key])),...(id==='path'?d.terrain.map(t=>t.height):[]))*1.12;
 const x=v=>left+(459-v)/xmax*span,y=v=>top+plotH-v/ymax*plotH;
 let out='';for(let i=0;i<=4;i++){const value=ymax*i/4, yy=y(value);out+='<line x1="'+left+'" y1="'+yy+'" x2="978" y2="'+yy+'" stroke="#e2e7e4"/><text x="54" y="'+(yy+4)+'" text-anchor="end">'+f(value,0)+'</text>'}
 for(let i=0;i<=4;i++){const v=xmax*i/4,xx=left+v/xmax*span;out+='<text x="'+xx+'" y="'+(height-24)+'" text-anchor="middle">'+f(v,0)+'</text>'}
 if(id==='path')out+='<polyline fill="none" stroke="#9a9f90" stroke-dasharray="5 5" stroke-width="1.7" points="'+d.terrain.map(t=>x(t.z)+','+y(t.height)).join(' ')+'"/>';
 for(const s of series)out+='<polyline fill="none" stroke="'+s.color+'" stroke-width="2.7" points="'+rows.map(v=>x(v.z)+','+y(v[s.key])).join(' ')+'"/>';
 if(r.damage){const end=r.damage.before;out+='<circle cx="'+x(end.z)+'" cy="'+y(end[series[0].key])+'" r="5" fill="#c55730"/>'}
 out+='<text x="64" y="12">'+label+'</text><text x="520" y="'+(height-4)+'" text-anchor="middle">Northward progress from spawn (m)</text>';el(id).innerHTML=out;
}
function draw(){const r=d.runs.find(r=>r.id===el('aircraft').value&&r.load===el('load').value&&r.mode===el('mode').value&&r.wind===el('wind').value&&r.hz===60),e=endpoint(r);
 el('metrics').innerHTML=[['Initial mass',f(r.initial.mass)+' kg'],['Liftoff',f(r.liftoff.time,2)+' s'],['Climb at end',f(e.verticalSpeed)+' m/s'],['Result',r.outcome]].map(([label,value])=>'<div class="metric"><span>'+label+'</span><strong>'+value+'</strong></div>').join('');
 el('description').textContent='Final undamaged state: '+f(e.time,2)+' s, altitude '+f(e.y)+' m, true airspeed '+f(e.knots)+' kt, pitch '+f(e.pitchDegrees)+'°, flight path '+f(e.pathDegrees)+'°, angle of attack '+f(e.alphaDegrees)+'°, body-proxy clearance '+f(e.bodyClearance,2)+' m. '+(r.damage?'First contact: '+contact(r)+'.':'');
 chart('path',r,[{key:'y',color:'#246b56'},{key:'terrain',color:'#9a9f90'}],330,'Altitude (m)');chart('speed',r,[{key:'speed',color:'#2e6c9d'},{key:'stallSpeed',color:'#b46937'}],230,'Speed (m/s)');
}
for(const id of ['aircraft','load','mode','wind'])el(id).addEventListener('change',draw);draw();
</script></body></html>`;
await Bun.write(root + "docs/validation/DEPARTURE_RESEARCH.html", html);
await Bun.write(root + "lab/public/departure-research.html", html);
console.log("Saved docs/validation/DEPARTURE_RESEARCH.html and local-only tester copy.");
