'use strict';
const $ = id => document.getElementById(id);
const csrf = document.querySelector('meta[name="vibeguard-csrf"]').content;
let state;
const categories = {'cost.unbounded_api_calls':'Put a limit on paid calls.','security.hardcoded_secret':'Keep secrets out of code.','safety.destructive_command':'Make destructive changes explicit.'};
function node(tag, text, cls) { const n = document.createElement(tag); if(text!==undefined) n.textContent = text; if(cls) n.className=cls; return n; }
function notice(text, error=false) { $('notice').hidden=false; $('notice').textContent=text; $('notice').className=error?'error':''; }
async function api(route, payload) { const opts=payload?{method:'POST',headers:{'Content-Type':'application/json','X-VibeGuard-CSRF':csrf},body:JSON.stringify(payload)}:{}; const r=await fetch(route,opts); const data=await r.json(); if(!r.ok) throw new Error(data.error||'Request failed'); return data; }
async function busy(button, action) { button.disabled=true; try { await action(); } catch(e){notice(e.message,true);} finally {button.disabled=false;} }
function loadTask() { const t=state.tasks.find(t=>t.task_id===$('task').value); if(!t) return; $('prompt').value=t.prompt; $('draft').value=t.draft; $('check-result').hidden=true; $('costar').replaceChildren(); }
function renderProposal() {
  const rules=state.rules; const active=rules.filter(r=>r.status==='approved');
  $('rule-count').textContent=active.length+' active';
  const proposed=rules.find(r=>r.status==='proposed'); const box=$('proposal'); box.replaceChildren();
  if(!proposed){const empty=node('div',undefined,'empty');empty.append(node('div','↗','empty-icon'),node('h3',state.runs.length?'Your boundaries are up to date.':'A failure becomes a boundary.'),node('p',state.runs.length?'Rerun the evaluation to measure your approved rules.':'Run the frozen evaluation to discover the first rule worth reviewing.'));box.append(empty);}
  else {
    const p=state.previews[proposed.rule_id];
    box.append(node('div',proposed.rule_id+' / PROPOSED','rule-id'),node('h3',categories[proposed.category]||proposed.category,'proposal-title'),node('div',proposed.user_message,'rule-message'));
    const metrics=node('div',undefined,'evidence-mini');
    for(const [value,label] of [[p.before+' → '+p.after,'Training passes / '+p.total],[p.false_blocks,'False blocks'],[p.regressions.length,'Regressions']]) {const m=node('div');m.append(node('strong',String(value)),node('small',label));metrics.append(m);}box.append(metrics,node('p',p.reason,'origin'),node('p','Learned from '+proposed.origin.task_id+' · '+proposed.origin.run_id,'origin'));
    const label=node('label',undefined,'approval');const check=node('input');check.type='checkbox';check.id='human-approval';label.htmlFor=check.id;label.append(check,node('span','I reviewed this rule and approve adding this boundary.'));box.append(label);
    const button=node('button','Approve boundary →');button.disabled=true;check.addEventListener('change',()=>button.disabled=!check.checked||!p.eligible);
    button.addEventListener('click',()=>busy(button,async()=>{await api('/api/approve',{rule_id:proposed.rule_id,confirmed:true});await refresh();notice('Boundary approved. Run the evaluation again to measure the change.');}));box.append(button);
  }
  $('active-rules').replaceChildren();
  if(!active.length&&!rules.some(r=>r.status==='reverted')) $('active-rules').append(node('p','No approved or reverted rules yet.','origin'));
  for(const r of rules.filter(r=>r.status!=='proposed')){const div=node('div',undefined,'active-rule');div.append(node('strong',r.rule_id+' · '+r.status),node('p',r.user_message));if(r.status==='approved'){const b=node('button','Revert…');b.addEventListener('click',()=>{const reason=window.prompt('Why should this rule be reverted? The record and receipt will be kept.');if(reason&&window.confirm('Revert '+r.rule_id+'? This removes an active boundary.'))busy(b,async()=>{await api('/api/revert',{rule_id:r.rule_id,reason,confirmed:true});await refresh();notice('Rule reverted; its record and receipt were preserved.');});});div.append(b);}$('active-rules').append(div);}
}
function renderRuns(){
 const runs=state.runs, last=runs.at(-1);$('heldout').replaceChildren(document.createTextNode(last?String(last.heldout.passed):'—'),node('span','/ 6'));$('train').replaceChildren(document.createTextNode(last?String(last.train.passed):'—'),node('span','/ 10'));$('false-blocks').textContent=last?last.false_blocks:'—';
 $('heldout-caption').textContent=last?'Baseline '+runs[0].heldout.passed+'/6 · latest '+last.heldout.passed+'/6':'Run a baseline to begin.';
 $('timeline').replaceChildren();runs.forEach((r,i)=>{const card=node('div',undefined,'run-card');card.append(node('small','RUN '+String(i+1).padStart(2,'0')+' · '+r.rules_active.length+' RULES'),node('strong',r.heldout.passed+'/'+r.heldout.total),node('small','held-out passes'));$('timeline').append(card);});
 $('traces').replaceChildren();if(last)for(const t of last.traces){const row=node('tr');for(const value of [t.task_id,t.split,t.verdict.passed?'Pass':t.shipped?'Fail':'Not shipped',t.attempts,t.blocked_by.join(', ')||'—'])row.append(node('td',String(value)));$('traces').append(row);}
}
function renderVoyage(){
  const check=state.voyage_check||{status:'untested'};
  if(check.status==='passed') $('voyage-detail').textContent='Embedding verified · '+check.model+' · '+check.dimensions+' dimensions';
  else if(check.status==='failed') $('voyage-detail').textContent='Embedding check failed · '+check.error;
  else $('voyage-detail').textContent=state.voyage_configured?'Voyage key configured · embedding check pending':'Voyage embedding API not configured';
}
async function refresh(){state=await api('/api/state');$('connection').textContent=state.storage+' · connected';$('storage-detail').textContent=state.atlas_configured?'Atlas stores rules, runs and audit receipts.':'Using local files. Atlas cluster exists; app connection is pending.';renderVoyage();$('dataset').textContent=state.dataset_hash.slice(0,12);if(!$('task').options.length){for(const t of state.tasks){const o=node('option',t.task_id+' · '+t.prompt);o.value=t.task_id;$('task').append(o);}loadTask();}renderProposal();renderRuns();}
$('voyage-check').addEventListener('click',()=>busy($('voyage-check'),async()=>{try {await api('/api/voyage/check',{});} finally {await refresh();}notice('Voyage embedding API verified.');}));
$('task').addEventListener('change',loadTask);
$('run').addEventListener('click',()=>busy($('run'),async()=>{await api('/api/run',{});await refresh();notice('Evaluation saved. Review the proposed boundary before activating it.');}));
$('check').addEventListener('click',()=>busy($('check'),async()=>{const result=await api('/api/check',{prompt:$('prompt').value,draft:$('draft').value});const box=$('check-result');box.hidden=false;box.className='result'+(result.blocked?' blocked':'');box.replaceChildren(node('strong',result.blocked?'Pause before shipping · '+result.rule_id:'Active rule check passed'),node('p',result.message));result.questions.forEach(q=>box.append(node('p',q)));$('costar').replaceChildren();for(const s of result.scores)$('costar').append(node('span',s.dimension,'dimension'+(s.p_present>=.5?' present':'')));}));
refresh().catch(e=>{$('connection').textContent='Connection unavailable';notice(e.message,true);});
