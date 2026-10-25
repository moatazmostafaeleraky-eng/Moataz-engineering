import {RobotViewer} from './robot-viewer.js?v=neutral-2';
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let defaults,catalog,project=null,scene=null,cell={task_poses:[],obstacles:[]},job=null,dirty=false,currentTab='design';
let baseRequirements=null,angleTimer=null,angleSequence=0;
let actionPending=false;
let sizingData=null,benchmarkData=null,inspectedReference=null;
const stateNames={DRAFT:'Draft',CALCULATED:'Calculated · Review needed',ENGINEERING_REVIEW:'Engineering review'};
const statusNames={pass:'Pass within check scope',fail:'Failed',unknown:'Unverified',not_applicable:'Not applicable'};
const fmt=(v,n=2)=>typeof v==='number'?v.toFixed(n):'—';
async function api(path,body,method){
  const response=await fetch(path,{method:method||(body!==undefined?'POST':'GET'),headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok){let d=data.detail||'Unable to complete the request';if(Array.isArray(d))d=d.map(e=>`${e.loc.join('.')}: ${e.msg}`).join('\n');throw new Error(d)}
  return data;
}
function notice(message,info=false){$('notice').hidden=!message;$('notice').textContent=message;$('notice').className=info?'info':''}
function handle(fn){return async (...args)=>{try{await fn(...args)}catch(e){notice(e.message);console.error(e)}}}
function action(fn){return handle(async(...args)=>{if(job||actionPending)return;actionPending=true;setBusy(true);$('job-message').textContent='Preparing request…';$('job-progress').value=0;try{await fn(...args)}finally{actionPending=false;setBusy(false)}})}
const modeForTab={design:'design',checks:'design',benchmark:'benchmark','robodk-builder':'benchmark',sizing:'actuator',bom:'actuator',compare:'compare','r1-benchmark':'compare',export:'compare'};
const defaultTabForMode={design:'design',benchmark:'benchmark',actuator:'sizing',compare:'compare'};
const tabHeadings={
 design:['MODE 1 · NEW ROBOT DESIGN','Design. Test. Refine.','Start with requirements, optimize a full 6R geometry, then validate the saved revision.'],
 checks:['MODE 1 · ENGINEERING CHECKS','Evidence before decisions','Review assumptions, warnings, sources, confidence and revision-bound checks.'],
 benchmark:['MODE 2 · COMPETITOR BENCHMARK','Import. Inspect. Benchmark.','Analyze supported RoboDK reference files without guessing missing manufacturer data.'],
 'robodk-builder':['MODE 2 · STEP TO ROBODK ROBOT','Build a RoboDK .robot file','Map seven STEP link objects and provide the robot-specific kinematics before building.'],
 sizing:['MODE 3 · ACTUATOR ENGINEERING','Size every axis','Worst-case static holding torque, dynamic peak and RMS torque on the task path, motor speed, and the payload the arm can hold.'],
 bom:['MODE 3 · ACTUATOR ENGINEERING','Catalog, BOM & evidence','Review the local component reference data and current sourcing gaps.'],
 compare:['MODE 4 · COMPARE & REPORT','Compare design candidates','Run bounded catalog comparisons and review trade-offs against a saved revision.'],
 'r1-benchmark':['MODE 4 · BENCHMARK','Measure against RAED R-1','Compare the saved design with the R-1 target specification and competitor references.'],
 export:['MODE 4 · REVIEW & CAD EXPORT','One package. One recorded revision.','Prepare an engineering-review package tied to a specific saved input snapshot.']
};
function tab(name){
  if(name!==currentTab&&$('notice').className==='info')notice('');
  currentTab=name;
  document.querySelectorAll('.tab').forEach(e=>e.classList.toggle('active',e.id===`tab-${name}`));
  document.querySelectorAll('[data-tab]').forEach(e=>e.classList.toggle('active',e.dataset.tab===name));
  const mode=modeForTab[name]||'design';
  document.querySelectorAll('[data-mode]').forEach(e=>e.classList.toggle('active',e.dataset.mode===mode));
  document.querySelectorAll('[data-subnav]').forEach(e=>{e.hidden=e.dataset.subnav!==mode});
  const heading=tabHeadings[name]||tabHeadings.design;
  $('page-eyebrow').textContent=heading[0];$('page-title').textContent=heading[1];$('page-description').textContent=heading[2];
  $('calculate-btn').hidden=mode!=='design'||name!=='design';
  $('compare-btn').hidden=!['design','actuator','compare'].includes(mode);
  $('heading-actions').hidden=$('calculate-btn').hidden&&$('compare-btn').hidden;
  document.querySelector('.revision-bar').hidden=mode==='benchmark';
  document.querySelector('.workflow-steps').hidden=mode!=='design'||name!=='design';
  if(name==='design')draw();
  if(name==='sizing')handle(loadSizing)();
  if(name==='r1-benchmark')handle(loadBenchmark)();
}
document.querySelectorAll('[data-tab]').forEach(e=>e.onclick=()=>tab(e.dataset.tab));
document.querySelectorAll('[data-mode]').forEach(e=>e.onclick=()=>tab(defaultTabForMode[e.dataset.mode]||'design'));
function markDirty(){dirty=true;$('revision-hint').textContent='Unsaved changes · Results and scene refer to the saved revision.';$('download').hidden=true}
function values(){
  if(!$('requirements-form').reportValidity())throw new Error('Check the required form values.');
  const req=structuredClone(baseRequirements||defaults.requirements);
  for(const [name,id,unit] of [['workpiece_mass_kg','workpiece','kg'],['payload_kg','payload','kg'],['reach_m','reach','m'],['cycle_time_s','cycle','s'],['tcp_speed_m_s','speed','m/s']])req[name]={...(req[name]||{}),value:Number($(id).value),unit};
  req.application=$('application').value;req.payload_includes_tool=$('includes-tool').value==='unknown'?null:$('includes-tool').value==='yes';
  req.tool_choice=$('tool').value;req.locked_tool_id=req.tool_choice==='auto'?null:req.tool_choice;
  req.materials_allowed=$('material').value==='all'?catalog.materials.map(m=>m.id):[$('material').value];
  req.locked_material_id=$('material').value==='all'?null:$('material').value;
  req.processes_allowed=[$('process').value];req.delivery_governorate=$('governorate').value||null;
  req.max_robot_mass_kg=$('max-mass').value?{value:Number($('max-mass').value),unit:'kg'}:null;
  req.inventory_only=$('inventory-only').checked;
  let inventory;try{inventory=JSON.parse($('inventory').value)}catch{throw new Error('Inventory is not valid JSON.')}
  if(!Array.isArray(inventory))throw new Error('Inventory must be a JSON array.');
  return {requirements:req,workcell:structuredClone(cell),inventory};
}
function fill(data){
  const r=data.requirements||defaults.requirements;baseRequirements=structuredClone(r);
  for(const [name,id] of [['workpiece_mass_kg','workpiece'],['payload_kg','payload'],['reach_m','reach'],['cycle_time_s','cycle'],['tcp_speed_m_s','speed']])$(id).value=r[name]?.value??'';
  $('application').value=r.application;$('includes-tool').value=r.payload_includes_tool===null?'unknown':r.payload_includes_tool?'yes':'no';
  $('tool').value=r.locked_tool_id||r.tool_choice;$('material').value=r.locked_material_id||(r.materials_allowed.length===1?r.materials_allowed[0]:'all');
  $('process').value=r.processes_allowed[0];$('governorate').value=r.delivery_governorate||'';$('max-mass').value=r.max_robot_mass_kg?.value??'';
  $('inventory-only').checked=r.inventory_only;$('inventory').value=JSON.stringify(data.inventory||[],null,2);
  cell=structuredClone(data.workcell||defaults.workcell);renderTasks();renderObstacles();dirty=false;
}
async function projectList(){const items=await api('/api/projects');$('projects').innerHTML='<option value="">Select a project</option>'+items.map(p=>`<option value="${esc(p.project_id)}">${esc(p.name||p.project_id)}</option>`).join('');$('projects').value=project?.project_id||''}
function revisionUrl(suffix){if(!project?.selected_revision)throw new Error('Save and calculate a revision first.');return `/api/projects/${project.project_id}/revisions/${project.selected_revision}/${suffix}`}
async function loadProject(pid,keepInputs=false){
  project=await api(`/api/projects/${pid}`);localStorage.setItem('raed-project',pid);
  $('project-title').textContent=project.name;$('project-name').value=project.name;$('project-name').disabled=true;
  $('project-state').textContent=stateNames[project.state]||project.state;
  $('revisions').innerHTML=Object.keys(project.configurations).reverse().map(r=>`<option value="${esc(r)}">${esc(r)} · ${esc(project.configurations[r].family_id)}</option>`).join('')||'<option value="">No saved revisions</option>';
  $('revisions').value=project.selected_revision||'';
  const snap=project.snapshots?.[project.selected_revision];
  if(!keepInputs){fill(snap?.data||{requirements:project.requirements,workcell:project.workcell,inventory:project.inventory});$('revision-hint').textContent=snap?`Saved inputs · ${snap.hash.slice(0,12)}`:'Enter requirements, then save your first revision.'}
  const solver=project.results[project.selected_revision];renderSolver(solver);sizingData=benchmarkData=null;
  if(currentTab==='sizing')loadSizing().catch(e=>notice(e.message));if(currentTab==='r1-benchmark')loadBenchmark().catch(e=>notice(e.message));
  if(project.selected_revision){scene=await api(revisionUrl('scene'));renderSceneControls();if(solver){const rep=await api(revisionUrl('reports'));renderReports(rep)}else renderReports(null)}
  else {scene=await api('/api/preview',values());renderSceneControls();renderReports(null)}
  $('scene-label').textContent=project.selected_revision||'Initial preview';draw();await projectList();
}
async function saveInput(){
  const input=values();
  if(!project){project=await api('/api/projects',{name:$('project-name').value||'New robot project'})}
  const result=await api(`/api/projects/${project.project_id}/configurations`,input);
  await loadProject(project.project_id);return result.revision_id;
}
function setBusy(b){for(const id of ['calculate-btn','compare-btn','review-export','robodk-build','new-project','projects','revisions'])$(id).disabled=b;$('job-panel').hidden=!b}
async function track(initial,onDone){
  job=initial;const pid=initial.project_id;setBusy(true);notice('');
  try{
    for(;;){
      const item=await api(`/api/jobs/${initial.job_id}`);job=item;
      $('job-progress').value=item.progress;$('job-message').textContent=`${{calculate:'Calculating revision',optimize:'Compare designs',export:'Preparing review package'}[item.kind]} · ${item.progress}% — ${item.message||item.status}`;
      if(item.status==='failed')throw new Error(item.error||'The job failed.');
      if(item.status==='cancelled'){notice('The job was cancelled.',true);break}
      if(item.status==='succeeded'){if(project?.project_id===pid){await loadProject(pid,true);await onDone?.(item.result)}break}
      await new Promise(resolve=>setTimeout(resolve,700));
    }
  }finally{job=null;setBusy(false)}
}
$('calculate-btn').onclick=action(async()=>{await saveInput();await track(await api(revisionUrl('calculations'),{}),()=>notice('Calculation complete and results saved. Review missing and failed checks before making an engineering decision.',true))});
$('compare-btn').onclick=action(async()=>{if(!project?.selected_revision||dirty)await saveInput();tab('compare');await track(await api('/api/optimization/jobs',{project_id:project.project_id,revision_id:project.selected_revision,limit:6}),renderCandidates)});
$('cancel-job').onclick=handle(async()=>{if(job){await api(`/api/jobs/${job.job_id}/cancel`,{});$('job-message').textContent='Cancellation requested. Waiting for the current calculation step to finish.'}});
$('projects').onchange=handle(async e=>{if(e.target.value){$('download').hidden=true;$('candidates').innerHTML='Run a comparison for this project.';await loadProject(e.target.value)}});
$('new-project').onclick=handle(async()=>{project=null;localStorage.removeItem('raed-project');$('project-title').textContent='New project';$('project-name').disabled=false;$('project-name').value='New handling robot';$('project-state').textContent='Draft';$('revisions').innerHTML='<option value="">No saved revisions</option>';$('revision-hint').textContent='Enter requirements, then save your first revision.';$('download').hidden=true;$('candidates').innerHTML='Run a comparison for this project.';fill(defaults);renderSolver();renderReports(null);scene=await api('/api/preview',values());renderSceneControls();$('scene-label').textContent='Initial preview';draw();await projectList();tab('design');notice('')});
$('revisions').onchange=handle(async e=>{if(e.target.value){await api(`/api/projects/${project.project_id}/revisions/${e.target.value}/select`,{});$('download').hidden=true;await loadProject(project.project_id)}});
$('requirements-form').addEventListener('input',markDirty);$('requirements-form').onsubmit=e=>e.preventDefault();
$('parse-btn').onclick=handle(async()=>{const data=await api('/api/assistant/parse-request',{text:$('prompt').value});const savedCell=structuredClone(cell);fill({requirements:data.requirements,workcell:savedCell});markDirty();notice('Values extracted. Unspecified values are starting assumptions, not confirmed requirements. Review the form and payload definition.',true)});
$('add-task').onclick=()=>{if(!scene)return;if(cell.task_poses.length>=16)return notice('This release supports up to 16 task poses.');cell.task_poses.push({id:'P'+Date.now(),pose:{...scene.tcp},require_orientation:true});cell.path_ids=[];renderTasks();markDirty();draw()};
function renderTasks(){
  $('task-list').innerHTML=cell.task_poses.length?cell.task_poses.map((t,i)=>`<div class="task-row"><div class="coordinates">${['x_m','y_m','z_m'].map(k=>`<label>${k[0].toUpperCase()}<input type="number" step="0.01" value="${t.pose[k]}" data-task="${i}" data-axis="${k}" aria-label="${k} Pose ${i+1}"></label>`).join('')}<button class="text-btn" data-remove-task="${i}" aria-label="Remove pose ${i+1}">×</button></div><label class="check-label"><input type="checkbox" data-orientation="${i}" ${t.require_orientation?'checked':''}> Lock tool orientation at pose ${i+1}</label><small class="muted">quaternion: ${[t.pose.qw,t.pose.qx,t.pose.qy,t.pose.qz].map(x=>fmt(x,3)).join(', ')}</small></div>`).join(''):'<div class="no-data">No task poses yet. Add a TCP pose or enter a target position.</div>';
  $('task-list').querySelectorAll('[data-task]').forEach(e=>e.onchange=()=>{cell.task_poses[+e.dataset.task].pose[e.dataset.axis]=Number(e.value);markDirty();draw()});
  $('task-list').querySelectorAll('[data-orientation]').forEach(e=>e.onchange=()=>{cell.task_poses[+e.dataset.orientation].require_orientation=e.checked;markDirty()});
  $('task-list').querySelectorAll('[data-remove-task]').forEach(e=>e.onclick=()=>{cell.task_poses.splice(+e.dataset.removeTask,1);cell.path_ids=[];renderTasks();markDirty();draw()});
}
$('add-obstacle').onclick=()=>{cell.obstacles.push({id:'B'+Date.now(),kind:'box',pose:{x_m:.7,y_m:.4,z_m:.2,qw:1,qx:0,qy:0,qz:0,frame:'world'},size_m:[.3,.3,.4]});renderObstacles();markDirty();draw()};
function renderObstacles(){
  $('obstacle-list').innerHTML=cell.obstacles.length?cell.obstacles.map((o,i)=>`<div class="obstacle-row"><div class="coordinates">${['x_m','y_m','z_m'].map(k=>`<label>${k[0].toUpperCase()}<input type="number" step="0.05" value="${o.pose[k]}" data-obs="${i}" data-axis="${k}" aria-label="${k} Obstacle ${i+1}"></label>`).join('')}<button class="text-btn" data-remove-obs="${i}" aria-label="Remove obstacle ${i+1}">×</button></div><div class="coordinates">${o.size_m.map((s,j)=>`<label>${['Width','Depth','Height'][j]}<input type="number" step="0.05" min="0.01" value="${s}" data-size="${i}" data-axis="${j}" aria-label="Dimension ${j+1} Obstacle ${i+1}"></label>`).join('')}</div></div>`).join(''):'<div class="no-data">No obstacles have been added to the workcell.</div>';
  $('obstacle-list').querySelectorAll('[data-obs]').forEach(e=>e.onchange=()=>{cell.obstacles[+e.dataset.obs].pose[e.dataset.axis]=Number(e.value);markDirty();draw()});
  $('obstacle-list').querySelectorAll('[data-size]').forEach(e=>e.onchange=()=>{cell.obstacles[+e.dataset.size].size_m[+e.dataset.axis]=Number(e.value);markDirty();draw()});
  $('obstacle-list').querySelectorAll('[data-remove-obs]').forEach(e=>e.onclick=()=>{cell.obstacles.splice(+e.dataset.removeObs,1);renderObstacles();markDirty();draw()});
}
function renderSolver(sol){
  $('metric-mass').textContent=fmt(sol?.robot_mass_kg,1);$('metric-cycle').textContent=fmt(sol?.cycle_time_s,2);$('metric-unknown').textContent=sol?sol.checks.filter(c=>c.status==='unknown').length:'—';$('check-count').textContent=sol?sol.checks.length:'—';
  const hasPathEstimate=typeof sol?.cycle_time_s==='number'&&Number.isFinite(sol.cycle_time_s);
  const targetCycle=baseRequirements?.cycle_time_s?.value??defaults?.requirements?.cycle_time_s?.value;
  $('metric-cycle-title').textContent=hasPathEstimate?'Estimated path time':'Target cycle time';
  $('metric-cycle').textContent=fmt(hasPathEstimate?sol.cycle_time_s:targetCycle,2);
  $('metric-cycle-note').textContent=hasPathEstimate?'s · Geometric estimate; excludes motor dynamics.':'s · Requirement; add 2+ poses and calculate for estimate.';
  const el=$('checks-content');el.className=sol?'':'empty';el.innerHTML=sol?sol.checks.map(c=>`<div class="check-card"><div><h3 dir="ltr">${esc(c.name)}</h3><span class="${esc(c.status)} tiny">● ${esc(statusNames[c.status])}</span></div><div><p>${esc(c.method)}</p><p>${esc(c.assumptions)}</p><p>${esc(c.evidence)}</p><code>${esc(c.value===null?'':JSON.stringify(c.value))}${c.unit?' '+esc(c.unit):''}</code>${c.reasons.length?`<p class="fail">${esc(c.reasons.join(' · '))}</p>`:''}</div></div>`).join(''):'Save and calculate a revision to view checks and evidence.';
}
function renderActuatorCatalog(data){
  const rows=[];
  const add=(kind,items,keyFields)=>items.forEach(item=>{
    const specs=item.specs||{};
    const detail=keyFields.filter(([key])=>specs[key]!==undefined).map(([key,label,unit])=>`${label}: ${specs[key]}${unit?' '+unit:''}`).join(' · ')||'No sizing specs recorded';
    rows.push({kind,name:`${item.manufacturer||'—'} ${item.model||item.name||item.id}`,detail,source:item.data_source||'Source not recorded',evidence:`CAD ${item.cad_status||'unknown'} · Cost ${item.cost_status||'unknown'}`});
  });
  add('Motor',data.motors||[],[['rated_torque_nm','Rated torque','N·m'],['peak_torque_nm','Peak torque','N·m'],['rated_speed_rpm','Rated speed','rpm'],['rotor_inertia_kgm2','Rotor inertia','kg·m²']]);
  add('Gearbox',data.gearboxes||[],[['ratio','Ratio',''],['rated_torque_nm','Rated torque','N·m'],['peak_torque_nm','Peak torque','N·m'],['efficiency','Efficiency','']]);
  add('Bearing',data.bearings||[],[['id_mm','Bore','mm'],['od_mm','Outer diameter','mm'],['B_mm','Width','mm'],['C_dyn_n','Dynamic rating','N']]);
  add('Fastener',data.fasteners||[],[['thread','Thread',''],['length_mm','Length','mm'],['standard','Standard','']]);
  rows.push({kind:'Encoder',name:'No encoder items in the current catalog',detail:'Not available',source:'No catalog record',evidence:'Not assessed'});
  rows.push({kind:'Drive',name:'No drive items in the current catalog',detail:'Not available',source:'No catalog record',evidence:'Not assessed'});
  const el=$('actuator-catalog');el.className='table-wrap';
  el.innerHTML=`<table><thead><tr><th>Type</th><th>Catalog item</th><th>Recorded specs</th><th>Source</th><th>Evidence</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.kind)}</td><td class="wrap">${esc(r.name)}</td><td class="wrap">${esc(r.detail)}</td><td class="wrap">${esc(r.source)}</td><td class="wrap">${esc(r.evidence)}</td></tr>`).join('')}</tbody></table>`;
}
function renderReports(rep){
  $('coverage').textContent=rep?`Verified purchased CAD: ${rep.coverage.verified_or_standard}/${rep.coverage.purchased_needing_geometry}`:'—';
  $('bom-content').className=rep?'table-wrap':'empty';$('bom-content').innerHTML=rep?`<table><thead><tr><th>Part</th><th>Description</th><th>Type</th><th>Quantity</th><th>CAD</th><th>Cost</th></tr></thead><tbody>${rep.bom.map(r=>`<tr><td dir="ltr">${esc(r.part_number)}</td><td class="wrap">${esc(r.description)}</td><td>${r.make_buy==='make'?'Make':'Buy'}</td><td>${esc(r.qty)}</td><td>${esc(r.cad_match||'—')}</td><td>${r.unit_cost===null?'Unknown':esc(r.unit_cost)+' '+esc(r.currency)}</td></tr>`).join('')}</tbody></table>`:'Calculate a revision to view its bill of materials.';
  $('procurement-content').textContent=rep?`${rep.procurement.length} purchased items need supplier review.`:'';
}
function renderCandidates(result){const el=$('candidates');el.className='candidate-grid';el.innerHTML=result.candidates.map(r=>`<article class="candidate"><h3>${esc(r.family_id)} / ${esc(r.material_id)}</h3><span class="pill ${r.feasible?'pass':'unknown'}">${r.feasible?'Checks satisfied':'Incomplete · Review checks'}</span><dl><dt>Estimated mass</dt><dd>${fmt(r.mass_kg,1)} kg</dd><dt>Geometric time</dt><dd>${fmt(r.cycle_s)} s</dd><dt>Pareto</dt><dd>${r.on_pareto?'Yes':'—'}</dd></dl><details><summary>${r.rejected.length} failed or unverified checks</summary>${r.rejected.map(x=>`<p>${esc(x)}</p>`).join('')}</details><button class="outline full" data-select="${esc(r.revision_id)}">Open revision</button></article>`).join('');el.querySelectorAll('[data-select]').forEach(b=>b.onclick=handle(async()=>{await api(`/api/projects/${project.project_id}/revisions/${b.dataset.select}/select`,{});await loadProject(project.project_id);tab('checks')}))}
$('review-export').onclick=action(async()=>{
  if(dirty)throw new Error('There are unsaved changes. Save and calculate a new revision before review.');
  if(!$('reviewer').value.trim())throw new Error('Enter a reviewer name to record the decision.');
  await api(revisionUrl('reviews'),{purpose:'review',reviewer:$('reviewer').value.trim(),notes:$('review-notes').value});
  await track(await api(revisionUrl('exports'),{}),r=>{$('download').href=r.download_url;$('download').hidden=false;notice('The review package is ready to download.',true)});
});
// Actual library mesh and saved-design solids share a local WebGL viewer.
const canvas=$('robot-canvas');
let viewer=null,viewMode='reference';
function draw(){
  if(!scene||!viewer?.model)return;
  viewer.update(scene,cell,viewMode,$('show-rom').checked);
  const reference=viewMode==='reference';
  $('scene-label').textContent=reference?'Industrial robot':project?.selected_revision||'Current design preview';
  $('model-scope').textContent=reference?'Solid geometry · 6-axis articulation':'Industrial shell · Saved design kinematics';
  $('model-note').textContent=reference?'Robot visual reference. Requirements, calculations and exports below belong to your design.':'Your design dimensions and joint poses. Body and tool shells are approximate; exports retain the existing concept CAD.';
  $('geometry-label').textContent=reference?'Solid robot geometry':'Approximate design geometry';
  $('model-specs').textContent=reference?'6 AXES  /  6 kg  /  1.373 m':'6 AXES  /  '+scene.family.name;
  $('joint-scope').textContent=reference?'Reference motion · Does not change your design':'Preview does not change saved results';
  $('home-pose').hidden=!reference;
  $('add-task').disabled=reference;
  $('add-task').title=reference?'Select Current design to capture its TCP pose.':'';
  const p=reference?viewer.referenceTransforms.at(-1).elements.slice(12,15):[scene.tcp.x_m,scene.tcp.y_m,scene.tcp.z_m];
  const belowFloor=p[2]<0;
  $('tcp-label').textContent=(reference?'Flange ':'TCP ')+p.map(n=>fmt(n,3)).join(' / ')+' m'+(belowFloor?' · below floor (Z < 0)':'');
  $('tcp-label').classList.toggle('fail',belowFloor);
}
function renderSceneControls(){
  if(!scene)return;
  const reference=viewMode==='reference'&&viewer?.model;
  const angles=reference?viewer.referenceAngles:scene.joints;
  const limits=reference?viewer.model.limits:scene.limits;
  $('joints').innerHTML=angles.map((q,i)=>`<div><div class="joint-label"><span>J${i+1}${reference?' · '+['S','L','U','R','B','T'][i]:''}</span><span id="joint-value-${i}">${fmt(q*180/Math.PI,1)}°</span></div><input aria-label="Joint ${i+1}" type="range" min="${limits[i][0]}" max="${limits[i][1]}" step="any" value="${q}" data-joint="${i}" ${reference||project?.selected_revision?'':'disabled'}></div>`).join('');
  $('joints').querySelectorAll('[data-joint]').forEach(e=>e.oninput=()=>{
    const i=+e.dataset.joint,q=Number(e.value);
    $('joint-value-'+i).textContent=fmt(q*180/Math.PI,1)+'°';
    if(reference){const next=[...viewer.referenceAngles];next[i]=q;viewer.setReferenceAngles(next);draw();return;}
    scene.joints[i]=q;clearTimeout(angleTimer);const seq=++angleSequence;
    const angles=[...scene.joints],url=revisionUrl('scene'),pid=project.project_id,rid=project.selected_revision;
    angleTimer=setTimeout(handle(async()=>{const next=await api(url,{joints:angles});if(seq===angleSequence&&pid===project?.project_id&&rid===project?.selected_revision){next.rom_points=scene.rom_points;scene=next;draw();}}),80);
  });
}
$('model-select').onchange=()=>{clearTimeout(angleTimer);angleSequence++;viewMode=$('model-select').value;renderSceneControls();draw();};
$('home-pose').onclick=()=>{if(!viewer?.model)return;viewer.setReferenceAngles(viewer.model.home);renderSceneControls();draw();viewer.reset();};
$('reset-view').onclick=()=>viewer?.reset();
$('show-rom').onchange=draw;
handle(async()=>{
  try{viewer=new RobotViewer(canvas);viewer.onError=message=>notice(message);await viewer.load();}
  catch(error){notice('3D viewer unavailable: '+error.message);viewMode='design';$('model-select').value='design';$('model-select').disabled=true;$('home-pose').hidden=true;$('show-rom').disabled=true;$('model-scope').textContent='3D viewer unavailable';$('viewer-error').hidden=false;$('viewer-error').textContent='3D viewer unavailable. Reload in a browser with WebGL 2 enabled.';}
  let geoCatalog;
  [defaults,catalog,geoCatalog]=await Promise.all([api('/api/defaults'),api('/api/catalog'),api('/api/full-design/categories')]);
  renderActuatorCatalog(catalog);
  // Assignment must be explicit; do not rely on DOM named properties.
  $('tool').insertAdjacentHTML('beforeend',catalog.tools.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join(''));
  $('material').insertAdjacentHTML('beforeend',catalog.materials.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join(''));
  const categories=Array.isArray(geoCatalog?.categories)?geoCatalog.categories:[];
  const geoFamilies=()=>{const cat=categories.find(c=>c.id===$('geo-category').value);const ids=cat?.templates||[];const rawFamilies=catalog.link_families||catalog.families||[];const families=Array.isArray(rawFamilies)?rawFamilies:Object.values(rawFamilies);$('geo-family').innerHTML=families.filter(f=>ids.includes(f.id)).map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');if(!$('geo-family').value)$('geo-family').value=ids[0]||''};
  $('geo-category').innerHTML=categories.map(c=>`<option value="${esc(c.id)}" title="${esc(c.name_ar)}" ${c.supported?'':'disabled'}>${esc(c.name)}${c.supported?'':' · coming soon'}</option>`).join('');
  $('geo-category').value='articulated_6r_industrial';$('geo-category').onchange=geoFamilies;geoFamilies();
  fill(defaults);const pid=localStorage.getItem('raed-project');if(pid){try{await loadProject(pid);return}catch(e){localStorage.removeItem('raed-project');notice('Unable to restore the previous project. Select a saved project or create a new one.')}}
  scene=await api('/api/preview',values());renderSceneControls();draw();await projectList();
})();

let fullGeometryResult=null;
function renderFullGeometry(result){
  fullGeometryResult=result;
  const el=$('geo-results');
  const candidates=result.candidates||[];
  el.className=candidates.length?'candidate-grid':'empty';
  const shown=fullGeometryResult.showAll?candidates:candidates.slice(0,6);
  el.innerHTML=shown.map((row,index)=>{
    const d=row.design||{},m=row.metrics||{};
    return `<article class="candidate"><h3>${row.feasible?'Reachable':'Rejected'} · ${esc(d.family_id||'')}</h3><span class="pill ${row.feasible?'pass':'unknown'}">${row.feasible?'Target reached':'Needs review'}</span><dl><dt>Upper arm</dt><dd>${fmt((d.upper_arm_m||0)*1000,0)} mm</dd><dt>Forearm</dt><dd>${fmt((d.forearm_m||0)*1000,0)} mm</dd><dt>Wrist offset</dt><dd>${fmt((d.wrist_offset_m||0)*1000,0)} mm</dd><dt>Target error</dt><dd>${fmt((row.target_error_m||0)*1000,2)} mm</dd><dt>Reach margin</dt><dd>${fmt((m.reach_margin_m||0)*1000,0)} mm</dd></dl><details><summary>${(row.rejected||[]).length} warnings</summary>${(row.rejected||[]).map(x=>`<p>${esc(x)}</p>`).join('')}</details>${row.feasible?`<button class="outline full" data-geo-export="${index}">Download STEP package</button>`:''}</article>`;
  }).join('')+(candidates.length>6?`<button type="button" class="outline full geo-more" id="geo-more">${fullGeometryResult.showAll?'Show top 6 only':`Show all ${candidates.length} candidates`}</button>`:'');
  $('geo-more')?.addEventListener('click',()=>{fullGeometryResult.showAll=!fullGeometryResult.showAll;renderFullGeometry(fullGeometryResult)});
  el.querySelectorAll('[data-geo-export]').forEach(button=>button.onclick=handle(async()=>{
    const row=fullGeometryResult.candidates[+button.dataset.geoExport];
    const response=await fetch('/api/full-design/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({design:row.design,tool_id:$('tool').value==='auto'?(catalog.tools.find(t=>t.family==='gripper')?.id||'rg2'):$('tool').value})});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.detail||'Unable to export full robot STEP package')}
    const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='RAED-FULL-ROBOT-STEP-PACKAGE.zip';a.click();URL.revokeObjectURL(url);notice('Full robot STEP package downloaded for engineering review.',true);
  }));
}

$('actuator-compare-launch').onclick=()=>$('compare-btn').click();

$('geo-optimize').onclick=action(async()=>{
  const target={x_m:Number($('geo-target-x').value),y_m:Number($('geo-target-y').value),z_m:Number($('geo-target-z').value),qw:1,qx:0,qy:0,qz:0,frame:'world'};
  const toolId=$('tool').value==='auto'?(catalog.tools.find(t=>t.family===($('application').value==='welding'?'welding_torch':'gripper'))?.id||'rg2'):$('tool').value;
  const result=await api('/api/full-design/optimize',{category_id:$('geo-category').value||'articulated_6r_industrial',family_id:$('geo-family').value||'medium',tool_id:toolId,target,require_orientation:false,workpiece_mass_kg:Number($('workpiece').value||0),payload_kg:Number($('payload').value||0),max_candidates:Number($('geo-candidates').value||24),objective:$('geo-objective').value});
  renderFullGeometry(result);notice(result.best?'Geometry candidates found. Review and export a selected design.':'No candidate reached the target with the current bounds.',!!result.best);
});

const robodkRoles=['base','joint1','joint2','joint3','joint4','joint5','joint6'];
$('rdk-joint-rows').innerHTML=Array.from({length:6},(_,i)=>`<tr><th scope="row">J${i+1}</th><td><input class="rdk-home" data-axis="${i}" type="number" step="any" aria-label="J${i+1} home in degrees" required></td><td><input class="rdk-low" data-axis="${i}" type="number" step="any" aria-label="J${i+1} minimum limit in degrees" required></td><td><input class="rdk-high" data-axis="${i}" type="number" step="any" aria-label="J${i+1} maximum limit in degrees" required></td><td><select class="rdk-sense" data-axis="${i}" aria-label="J${i+1} sense"><option value="">Select</option><option value="1">+1</option><option value="-1">−1</option></select></td></tr>`).join('');
function renderRoboDKPartMap(){
 const files=Array.from($('robodk-step-files').files||[]),el=$('robodk-part-map');
 if(files.length<7){el.className='empty small-empty';el.textContent='Choose at least seven STEP files to map the base and links 1–6.';return}
 const options=files.map((file,i)=>`<option value="${i}">${esc(file.name)}</option>`).join('');
 el.className='rdk-part-map';
 el.innerHTML=robodkRoles.map((role,index)=>{
  const pattern=role==='base'?/base/i:new RegExp(`(?:joint|link|j)[-_ ]*0?${index}\\b`,'i');
  const found=files.findIndex(file=>pattern.test(file.name));
  return `<label>${esc(role==='base'?'Base':`Joint ${index} / Link ${index}`)}<select data-rdk-role="${role}" aria-label="STEP part for ${esc(role)}"><option value="">Select a STEP part</option>${options}</select></label>`;
 }).join('');
 el.querySelectorAll('[data-rdk-role]').forEach(select=>{const role=select.dataset.rdkRole,index=robodkRoles.indexOf(role),file=files.findIndex(f=>(role==='base'?/base/i:new RegExp(`(?:joint|link|j)[-_ ]*0?${index}\\b`,'i')).test(f.name));select.value=file>=0?String(file):(files.length===7?String(index):'')});
}
$('robodk-step-files').onchange=renderRoboDKPartMap;
$('robodk-build').onclick=action(async()=>{
 const files=Array.from($('robodk-step-files').files||[]);
 if(files.length<7)throw new Error('Choose at least seven separate STEP objects: one base and one object for each joint link.');
 const selectors=Array.from(document.querySelectorAll('[data-rdk-role]'));
 if(selectors.length!==7||selectors.some(el=>el.value===''))throw new Error('Map the base and joints 1–6 to seven different STEP files.');
 const selections=Object.fromEntries(selectors.map(el=>[el.dataset.rdkRole,Number(el.value)]));
 if(robodkRoles.some(role=>!Number.isInteger(selections[role]))||new Set(Object.values(selections)).size!==7)throw new Error('Map the base and joints 1–6 to seven different STEP files.');
 if(!$('rdk-parts-home').checked)throw new Error('Confirm that the STEP objects are arranged in the entered home pose.');
 const parseArray=(value,count,label)=>{let data;try{data=JSON.parse(value)}catch{throw new Error(`${label} must be a JSON array.`)}if(!Array.isArray(data)||data.length!==count||data.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw new Error(`${label} must contain exactly ${count} finite numeric values.`);return data};
 const parameters=parseArray($('rdk-parameters').value,13,'RoboDK mechanism parameters');
 const homeInputs=Array.from(document.querySelectorAll('.rdk-home')),lowInputs=Array.from(document.querySelectorAll('.rdk-low')),highInputs=Array.from(document.querySelectorAll('.rdk-high')),senseInputs=Array.from(document.querySelectorAll('.rdk-sense'));
 if([...homeInputs,...lowInputs,...highInputs].some(e=>e.value.trim()==='')||senseInputs.some(e=>e.value===''))throw new Error('Enter home, minimum, maximum, and sense values for every joint.');
 const home=homeInputs.map(e=>Number(e.value)),low=lowInputs.map(e=>Number(e.value)),high=highInputs.map(e=>Number(e.value)),senses=senseInputs.map(e=>Number(e.value));
 if([...home,...low,...high].some(v=>!Number.isFinite(v)))throw new Error('Enter home, minimum, and maximum values for all six axes.');
 for(let i=0;i<6;i++){if(low[i]>=high[i])throw new Error(`J${i+1}: minimum limit must be below maximum limit.`);if(home[i]<low[i]||home[i]>high[i])throw new Error(`J${i+1}: home position must be within its limits.`)}
 const form=new FormData();form.append('robot_name',$('rdk-robot-name').value.trim());form.append('parameters_json',JSON.stringify(parameters));form.append('home_json',JSON.stringify(home));form.append('lower_limits_json',JSON.stringify(low));form.append('upper_limits_json',JSON.stringify(high));form.append('joint_senses_json',JSON.stringify(senses));form.append('part_map_json',JSON.stringify(selections));files.forEach(file=>form.append('step_files',file,file.name));
 const response=await fetch('/api/robodk/build',{method:'POST',body:form});
 if(!response.ok){const data=await response.json().catch(()=>({}));let detail=data.detail||'RoboDK build failed';if(Array.isArray(detail))detail=detail.map(e=>`${e.loc?.join('.')||'input'}: ${e.msg}`).join('\n');throw new Error(detail)}
 const mode=response.headers.get('X-RAED-ROBDK-MODE')||'macro_required',blob=await response.blob(),url=URL.createObjectURL(blob),link=$('robodk-build-download');
 if(link.dataset.url)URL.revokeObjectURL(link.dataset.url);link.dataset.url=url;link.href=url;link.download='RAED-ROBDK-6AXIS-BUILD-PACKAGE.zip';link.hidden=false;
 $('robodk-build-summary').className='empty build-summary';$('robodk-build-summary').textContent=mode==='native_robot'?'RoboDK created a .robot file. The ZIP includes it with the STEP source parts, build configuration, and permanent ownership notice. Verify motion in RoboDK before use.':'RoboDK was not available to the app, so the ZIP contains the seven STEP parts and a RoboDK macro. Extract it and run build_in_robodk.py inside RoboDK to create the .robot file.';
 notice(mode==='native_robot'?'RoboDK .robot file created and packaged. Review the robot’s motion and limits in RoboDK.':'Build kit prepared. Run the included macro in RoboDK to create the .robot file.',true);
});
$('robodk-import').onclick=action(async()=>{
  const input=$('robodk-robot-file');
  if(!input.files?.length)throw new Error('Choose an authorized .robot file first.');
  const smooth=$('robodk-smooth').checked;
  $('job-message').textContent=smooth?'Reverse-engineering smooth surfaces for every link… this can take 10+ minutes.':'Reconstructing validated solids from the RoboDK meshes… this can take several minutes.';
  const form=new FormData();form.append('file',input.files[0]);form.append('smooth',smooth?'true':'false');form.append('smooth_tolerance_mm',$('robodk-smooth-tol').value);
  const response=await fetch('/api/reference-import/robodk-robot',{method:'POST',body:form});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.detail||'RoboDK import failed')}
  const parts=response.headers.get('X-RAED-PARTS'),skipped=(response.headers.get('X-RAED-SKIPPED')||'').split(',').filter(Boolean),smoothCount=response.headers.get('X-RAED-SMOOTH');
  const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='ROBDK-REFERENCE-IMPORT.zip';a.click();URL.revokeObjectURL(url);
  notice(`RoboDK reference package downloaded: ${parts||'?'} validated solid link(s)`+(smooth?` · ${smoothCount||0} with smooth surfaces`:'')+(skipped.length?`; skipped ${skipped.join(', ')} (mesh could not be closed — see robot-import-report.json).`:'.')+' Review robot-import-report.json before using it.',!skipped.length);
});

$('robodk-inspect').onclick=action(async()=>{
  const input=$('robodk-robot-file');
  if(!input.files?.length)throw new Error('Choose an authorized .robot file first.');
  const form=new FormData();form.append('file',input.files[0]);
  const response=await fetch('/api/reference-import/robodk-robot/inspect',{method:'POST',body:form});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.detail||'RoboDK inspection failed');
  const dims=data.robot_envelope?.dimensions_m||[],limits=data.limits||[],mdh=data.mdh||[];
  const angle=rad=>fmt(rad*180/Math.PI,1)+'°';
  $('robodk-import-summary').className='table-wrap';
  $('robodk-import-summary').innerHTML=`<h3>${esc(data.name||'RoboDK model')}</h3><p class="muted tiny">${data.links.length} links · envelope ${dims.length?dims.map(x=>fmt(x*1000,1)).join(' × ')+' mm':'unknown'} · ${esc(data.cad_status||'reference')}</p><div class="benchmark-metrics"><span>Payload <b>${data.payload_kg===null?'Unknown':fmt(data.payload_kg,2)+' kg'}</b></span><span>Header reach <b>${data.reach_m===null?'Unknown':fmt(data.reach_m,3)+' m'}</b></span><span>Header mass <b>${data.mass_kg===null?'Unknown':fmt(data.mass_kg,2)+' kg'}</b></span><span>Envelope <b>${dims.length?dims.map(x=>fmt(x*1000,0)).join(' × ')+' mm':'Unknown'}</b></span></div><h4>Link mesh metrics · reference surfaces</h4><table><thead><tr><th>Link</th><th>Triangles</th><th>Envelope (mm)</th><th>Surface (m²)</th></tr></thead><tbody>${data.links.map(link=>`<tr><td>${esc(link.name)}</td><td>${link.metrics.triangle_count}</td><td>${(link.metrics.envelope_dimensions_m||[]).map(x=>fmt(x*1000,1)).join(' × ')}</td><td>${fmt(link.metrics.surface_area_m2,3)}</td></tr>`).join('')}</tbody></table><h4>Modified DH and joint limits · extracted metadata</h4><table><thead><tr><th>Axis</th><th>α (rad)</th><th>a (mm)</th><th>θ (rad)</th><th>d (mm)</th><th>Limit min</th><th>Limit max</th></tr></thead><tbody>${Array.from({length:Math.max(mdh.length,limits.length)}).map((_,i)=>{const d=mdh[i]||{},l=limits[i]||[];return `<tr><td>J${i+1}</td><td>${fmt(d.alpha,4)}</td><td>${fmt((d.a||0)*1000,1)}</td><td>${fmt(d.theta,4)}</td><td>${fmt((d.d||0)*1000,1)}</td><td>${l.length?angle(l[0]):'Unknown'}</td><td>${l.length?angle(l[1]):'Unknown'}</td></tr>`}).join('')}</tbody></table><p class="muted tiny">Header values are unverified reference metadata; exported STEP is a validated mesh-derived solid when the link is closed. Source SHA-256: <code>${esc(data.source_sha256||'—')}</code></p>${data.metadata_warnings?.length?`<p class="muted tiny">Warnings: ${esc(data.metadata_warnings.join(' · '))}</p>`:''}`;
  inspectedReference={name:String(data.name||'Imported RoboDK model').slice(0,120),payload_kg:data.payload_kg??null,reach_m:data.reach_m||null,mass_kg:data.mass_kg||null,source:'Imported RoboDK header · SHA-256 '+String(data.source_sha256||'').slice(0,16)};sizingData=benchmarkData=null;
  notice('Reference benchmark metrics loaded and added to “Benchmark vs RAED R-1”. Verify source metadata before comparing.',true);
});

// ---- Quick-start templates (starting assumptions; every value stays editable) ----
const down={qw:0,qx:0,qy:1,qz:0,frame:'world'};
const pose=(id,x,y,z)=>({id,pose:{x_m:x,y_m:y,z_m:z,...down},require_orientation:false});
const TEMPLATES=[
 {id:'r1-tending',label:'RAED R-1 class · CNC tending',hint:'11 kg · 1.30 m',app:'machine_tending',workpiece:8,payload:11,tool:'yes',reach:1.3,cycle:20,speed:1.0,
  poses:[pose('Conveyor',0.85,-0.55,0.75),pose('Chuck',1.05,0.35,0.95),pose('Out',0.6,0.85,0.75)],target:[1.05,0.35,0.95]},
 {id:'welding',label:'MIG welding cell',hint:'Torch · 1.40 m',app:'welding',workpiece:0,payload:6,tool:'yes',reach:1.4,cycle:45,speed:0.3,toolId:'mb-evo-24',
  poses:[pose('Seam-A',0.9,-0.3,0.55),pose('Seam-B',0.9,0.3,0.55),pose('Seam-C',1.1,0.3,0.55)],target:[1.0,0.0,0.55]},
 {id:'palletizing',label:'Palletizing / packaging',hint:'10 kg cartons',app:'palletizing',workpiece:10,payload:11,tool:'yes',reach:1.3,cycle:8,speed:1.5,
  poses:[pose('Infeed',0.7,-0.75,0.8),pose('Pallet-1',0.95,0.45,0.35),pose('Pallet-2',0.75,0.75,0.35)],target:[0.95,0.45,0.35]},
 {id:'pick',label:'Light pick & place',hint:'3 kg · 0.85 m',app:'pick_and_place',workpiece:2,payload:3,tool:'yes',reach:0.85,cycle:4,speed:1.0,
  poses:[pose('Pick',0.55,-0.3,0.4),pose('Place',0.55,0.3,0.4)],target:[0.55,0.3,0.4]},
];
function applyTemplate(t){
  $('application').value=t.app;$('workpiece').value=t.workpiece;$('payload').value=t.payload;$('includes-tool').value=t.tool;
  $('reach').value=t.reach;$('cycle').value=t.cycle;$('speed').value=t.speed;
  $('tool').value=t.toolId&&[...$('tool').options].some(o=>o.value===t.toolId)?t.toolId:'auto';
  if(!project)$('project-name').value=t.label;
  cell.task_poses=t.poses.map(p=>structuredClone(p));cell.path_ids=[];renderTasks();
  [$('geo-target-x').value,$('geo-target-y').value,$('geo-target-z').value]=t.target.map(v=>v.toFixed(2));
  const fam=t.reach>1.25?'long':t.reach>0.85?'medium':'compact';if([...$('geo-family').options].some(o=>o.value===fam))$('geo-family').value=fam;
  document.querySelectorAll('[data-template]').forEach(b=>b.classList.toggle('active',b.dataset.template===t.id));
  markDirty();draw();notice(`Template “${t.label}” applied. Values are starting assumptions — confirm them, then Save & calculate.`,true);
}
$('templates').innerHTML=TEMPLATES.map(t=>`<button type="button" class="template" data-template="${t.id}"><b>${esc(t.label)}</b><small>${esc(t.hint)}</small></button>`).join('');
$('templates').querySelectorAll('[data-template]').forEach(b=>b.onclick=()=>applyTemplate(TEMPLATES.find(t=>t.id===b.dataset.template)));

// ---- Axis torque sizing ----
const pct=v=>typeof v==='number'?Math.round(v*100)+' %':'—';
function calculatedRevision(){return project?.selected_revision&&project.results?.[project.selected_revision]?project.selected_revision:null}
async function loadSizing(){
  const rid=calculatedRevision();
  if(!rid){sizingData=null;$('sizing-summary').innerHTML='';$('sizing-pill').textContent='—';$('sizing-content').className='empty';$('sizing-content').textContent='Save and calculate a revision to size its axes.';return}
  if(sizingData?.revision_id!==rid){$('sizing-content').className='empty';$('sizing-content').textContent='Sweeping postures…';sizingData=await api(revisionUrl('actuator-sizing'))}
  renderSizing(sizingData);
}
function renderSizing(d){
  const over=d.axes.filter(a=>a.utilization>1).length;
  $('sizing-pill').textContent=over?`${over} ${over>1?'axes':'axis'} over rating`:'All axes within static rating';$('sizing-pill').className='pill '+(over?'fail':'pass');
  const cap=d.static_payload_capacity_kg,need=Number($('payload').value||0);
  $('sizing-summary').innerHTML=[
    ['Static payload capacity',cap==null?'—':fmt(cap,2)+' kg',cap!=null&&cap>=need?'pass':'fail',`Limiting axis ${d.limiting_axis||'—'} · requirement ${fmt(need,1)} kg`],
    ['Computed reach · flange',fmt(d.reach.flange_m,3)+' m','',`Wrist centre ${fmt(d.reach.wrist_centre_m,3)} m`],
    ['Estimated robot mass',fmt(d.robot_mass_kg,1)+' kg','',`Links ${fmt(d.mass_breakdown.links,1)} · actuators ${fmt(d.mass_breakdown.actuators,1)} kg`],
    ['Postures sampled',String(d.postures_sampled),'','J2 × J3 × J5 sweep'],
  ].map(([t,v,c,n])=>`<div class="metric"><span>${esc(t)}</span><strong class="${c}">${esc(v)}</strong><small>${esc(n)}</small></div>`).join('');
  const el=$('sizing-content');el.className='table-wrap';
  el.innerHTML=`<table class="sizing-table"><thead><tr><th>Axis</th><th>Motor / reducer</th><th>Worst static</th><th>Allowed cont.</th><th>Utilization</th><th>Limited by</th><th>Needed @ ${esc(fmt(need,1))} kg</th><th>Min. ratio for motor</th><th>TCP capacity</th></tr></thead><tbody>${d.axes.map(a=>{const u=a.utilization||0,cls=u>1?'fail':u>.8?'unknown':'pass';return `<tr><td><b>${esc(a.axis)}</b></td><td>${esc(a.motor_id)} / ${esc(a.gearbox_id)} <span class="muted">i=${fmt(a.ratio,0)}</span></td><td>${fmt(a.worst_case_torque_nm,1)} N·m</td><td>${fmt(a.allowed_continuous_nm,1)} N·m</td><td><div class="util"><div class="util-bar ${cls}" style="width:${Math.min(u,1.5)/1.5*100}%"></div><span class="util-limit"></span></div><span class="${cls}">${pct(a.utilization)}</span></td><td>${esc(a.limited_by)}</td><td>${fmt(a.required_static_nm_at_rated_payload,1)} N·m</td><td>${a.min_ratio_for_selected_motor==null?'—':fmt(a.min_ratio_for_selected_motor,0)}</td><td>${a.static_tcp_capacity_kg==null?'∞':fmt(a.static_tcp_capacity_kg,1)+' kg'}</td></tr>`}).join('')}</tbody></table><p class="muted tiny">${esc(d.scope)} Bar marker = 100 % of continuous rating.</p>`;
  renderDynamics(d.dynamics);
}
const AXIS_COLORS=['#7fb8ff','#b5edb2','#f2c46d','#ff8f8f','#c9a0ff','#7ee0d6'];
function torqueChart(p){
  const W=760,H=220,L=48,R=12,T=12,B=28,t=p.t_s,rows=p.torque_nm,tmax=t[t.length-1]||1;
  const vmax=Math.max(1,...rows.flat().map(Math.abs)),x=v=>L+(W-L-R)*v/tmax,y=v=>T+(H-T-B)*(1-(v+vmax)/(2*vmax));
  const grid=[-vmax,-vmax/2,0,vmax/2,vmax].map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L-6}" y="${y(v)+4}" text-anchor="end">${fmt(v,0)}</text>`).join('');
  const lines=[0,1,2,3,4,5].map(i=>`<polyline fill="none" stroke="${AXIS_COLORS[i]}" stroke-width="1.6" points="${t.map((tv,k)=>`${x(tv).toFixed(1)},${y(rows[k][i]).toFixed(1)}`).join(' ')}"/>`).join('');
  const legend=[0,1,2,3,4,5].map(i=>`<span><i style="background:${AXIS_COLORS[i]}"></i>J${i+1}</span>`).join('');
  return `<svg class="torque-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Joint torque over the task cycle">${grid}<text x="${W-R}" y="${H-6}" text-anchor="end">${fmt(tmax,2)} s</text><text x="${L}" y="${H-6}">0 s</text>${lines}</svg><div class="chart-legend">${legend}<span class="muted">N·m over one task cycle</span></div>`;
}
function renderDynamics(dyn){
  const el=$('dynamics-content'),pill=$('dynamics-pill');
  if(!dyn||!dyn.available){el.className='empty';el.textContent=dyn?.reason?`Dynamic analysis ${dyn.reason}.`:'Save and calculate a revision with two or more task poses.';pill.textContent='—';pill.className='pill';return}
  const ok=dyn.peak_ok&&dyn.rms_ok;pill.textContent=ok?'Peak, RMS and speed within ratings':'Exceeds a rating — see table';pill.className='pill '+(ok?'pass':'fail');
  const cls=u=>u>1?'fail':u>.8?'unknown':'pass';
  el.className='';
  el.innerHTML=`<p class="muted tiny">Path ${dyn.path.map(esc).join(' → ')} · cycle ${fmt(dyn.cycle_s,2)} s at ${fmt(dyn.tcp_speed_m_s,2)} m/s TCP speed</p>${torqueChart(dyn.profile)}<div class="table-wrap"><table class="sizing-table"><thead><tr><th>Axis</th><th>Peak torque</th><th>Peak allowed</th><th>RMS torque</th><th>Continuous allowed</th><th>Peak motor speed</th><th>Min. ratio · peak / RMS</th></tr></thead><tbody>${dyn.axes.map(a=>`<tr><td><b>${esc(a.axis)}</b></td><td>${fmt(a.peak_torque_nm,1)} N·m</td><td>${fmt(a.peak_allowed_nm,1)} N·m <span class="${cls(a.peak_utilization)}">${pct(a.peak_utilization)}</span></td><td>${fmt(a.rms_torque_nm,1)} N·m</td><td>${fmt(a.continuous_allowed_nm,1)} N·m <span class="${cls(a.rms_utilization)}">${pct(a.rms_utilization)}</span></td><td>${fmt(a.peak_motor_speed_rpm,0)} rpm <span class="${a.speed_ok?'pass':'fail'}">/ ${fmt(a.max_motor_speed_rpm,0)}</span></td><td>${fmt(a.min_ratio_for_peak,0)} / ${fmt(a.min_ratio_for_rms,0)}</td></tr>`).join('')}</tbody></table></div><p class="muted tiny">${esc(dyn.scope)}</p>`;
}

// ---- Benchmark vs RAED R-1 ----
async function loadBenchmark(){
  const rid=calculatedRevision();
  if(!rid){benchmarkData=null;$('benchmark-pill').textContent='—';$('target-checks').className='empty';$('target-checks').textContent='Save and calculate a revision, then refresh the benchmark.';$('benchmark-table').className='empty';$('benchmark-table').textContent='No benchmark yet.';return}
  if(benchmarkData?.design.id!==rid){$('target-checks').className='empty';$('target-checks').textContent='Computing reach and static capacity…';benchmarkData=await api(revisionUrl('benchmark'),{extra_references:inspectedReference?[inspectedReference]:[]})}
  renderBenchmark(benchmarkData);
}
function renderBenchmark(d){
  const fails=d.target_checks.filter(g=>g.status==='fail').length;
  $('benchmark-pill').textContent=fails?`${fails} gap${fails>1?'s':''} to close`:'Targets met (static)';$('benchmark-pill').className='pill '+(fails?'fail':'pass');
  $('target-checks').className='target-grid';
  $('target-checks').innerHTML=d.target_checks.map(g=>{const ratio=typeof g.design==='number'&&g.target?Math.max(0,Math.min(g.design/g.target,1.5)):0;return `<div class="target-card ${esc(g.status)}"><span>${esc(g.metric)}</span><strong>${g.design==null?'—':fmt(g.design,2)} <small>/ ${fmt(g.target,2)} ${esc(g.unit)}</small></strong><div class="util"><div class="util-bar ${g.status==='pass'?'pass':'fail'}" style="width:${ratio/1.5*100}%"></div><span class="util-limit"></span></div><small class="${esc(g.status)}">● ${esc(statusNames[g.status]||g.status)}</small>${g.note?`<small class="muted">${esc(g.note)}</small>`:''}</div>`}).join('');
  const rows=[d.design,...d.references];
  const maxOf=k=>Math.max(...rows.map(r=>r[k]||0),1e-9);
  const bar=(v,k)=>v==null?'<span class="muted">Unknown</span>':`<div class="cmp"><div class="cmp-bar" style="width:${v/maxOf(k)*100}%"></div><span>${fmt(v,k==='mass_kg'?0:2)}</span></div>`;
  $('benchmark-table').className='table-wrap';
  $('benchmark-table').innerHTML=`<table><thead><tr><th>Robot</th><th>Role</th><th>Payload (kg)</th><th>Reach (m)</th><th>Mass (kg)</th><th>Payload / mass</th><th>Evidence & source</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.role==='design'?'design-row':''}"><td><b>${esc(r.name)}</b></td><td><span class="role ${esc(r.role)}">${esc(r.role)}</span></td><td>${bar(r.payload_kg,'payload_kg')}</td><td>${bar(r.reach_m,'reach_m')}</td><td>${bar(r.mass_kg,'mass_kg')}</td><td>${r.payload_to_mass==null?'—':fmt(r.payload_to_mass,3)}</td><td class="wrap"><span class="tiny">${esc(r.evidence)}</span><br><span class="muted tiny">${esc(r.source)}</span></td></tr>`).join('')}</tbody></table><p class="muted tiny">${esc(d.scope)}</p>`;
}
$('run-benchmark').onclick=handle(async()=>{sizingData=benchmarkData=null;await loadBenchmark()});
$('pdf-report').onclick=handle(async()=>{
  const rid=calculatedRevision();if(!rid)throw new Error('Save and calculate a revision before downloading its report.');
  const response=await fetch(revisionUrl('report.pdf'));
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.detail||'Unable to build the PDF report')}
  const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=`RAED-${rid}-engineering-report.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  notice('Engineering report PDF downloaded.',true);
});
$('robodk-robot-file').addEventListener('change',e=>{$('robodk-file-name').textContent=e.target.files?.[0]?.name||'No file selected'});
