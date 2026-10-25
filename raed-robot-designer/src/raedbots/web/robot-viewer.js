import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {toCreasedNormals} from './vendor/BufferGeometryUtils.js';

const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const matrix=rows=>new THREE.Matrix4().set(...rows.flat());
const origin=m=>V().setFromMatrixPosition(m);
const pose=p=>new THREE.Matrix4().compose(V(p.x_m,p.y_m,p.z_m),new THREE.Quaternion(p.qx,p.qy,p.qz,p.qw).normalize(),V(1,1,1));

// The imported reference uses modified DH; the saved design uses server FK.
// Keep these two chains separate: reference motion must never change results.
export function referenceFrames(model,angles){
  const frames=[new THREE.Matrix4()];
  for(let i=0;i<6;i++){
    const r=model.mdh[i];
    frames.push(frames.at(-1).clone()
      .multiply(new THREE.Matrix4().makeRotationX(r.alpha))
      .multiply(new THREE.Matrix4().makeTranslation(r.a,0,0))
      .multiply(new THREE.Matrix4().makeRotationZ(r.theta+angles[i]))
      .multiply(new THREE.Matrix4().makeTranslation(0,0,r.d)));
  }
  return frames;
}

export class RobotViewer{
  constructor(canvas){
    this.canvas=canvas;
    this.world=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(36,1,.01,50);
    this.camera.up.set(0,0,1);
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.35;
    this.controls=new OrbitControls(this.camera,canvas);
    this.controls.enableDamping=false;
    this.controls.minDistance=.25;
    this.controls.maxDistance=12;
    this.controls.maxPolarAngle=Math.PI*.94;
    this.controls.addEventListener('change',()=>this.render());
    this.world.add(new THREE.HemisphereLight(0xdceaff,0x56655a,2.8));
    const key=new THREE.DirectionalLight(0xfff4df,4.2);
    key.position.set(2,-3,5);key.castShadow=true;
    key.shadow.mapSize.set(2048,2048);
    Object.assign(key.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:.1,far:15});
    key.shadow.bias=-.00015;key.shadow.normalBias=.004;
    this.world.add(key);
    const rim=new THREE.DirectionalLight(0xb2ddff,2.4);rim.position.set(-3,2,3);this.world.add(rim);
    this.materials={
      white:new THREE.MeshStandardMaterial({color:0xdfe4df,roughness:.32,metalness:.25}),
      dark:new THREE.MeshStandardMaterial({color:0x343d40,roughness:.46,metalness:.42}),
      steel:new THREE.MeshStandardMaterial({color:0x9cabb0,roughness:.24,metalness:.8}),
      black:new THREE.MeshStandardMaterial({color:0x151d20,roughness:.7,metalness:.15}),
      gold:new THREE.MeshStandardMaterial({color:0xd89f5c,roughness:.35,metalness:.65}),
    };
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(12,12),new THREE.ShadowMaterial({opacity:.3}));
    floor.position.z=-.004;floor.receiveShadow=true;this.world.add(floor);
    const grid=new THREE.GridHelper(6,30,0x526a70,0x2b3e45);grid.rotation.x=Math.PI/2;grid.position.z=-.003;
    grid.material.transparent=true;grid.material.opacity=.5;this.world.add(grid);
    this.reference=new THREE.Group();this.design=new THREE.Group();this.annotations=new THREE.Group();
    this.world.add(this.reference,this.design,this.annotations);
    this.mode='reference';this.referenceAngles=[];this.needsFit=true;
    this.resizeObserver=new ResizeObserver(()=>{this.resize();if(this.needsFit)this.reset();else this.render()});
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();canvas.dataset.renderState='lost';this.onError?.('3D graphics context was lost. Reload to restore the viewer.');});
    this.resize();
  }

  async load(){
    const response=await fetch('/static/models/up6.json');
    if(!response.ok)throw new Error('The robot model could not be loaded. Reload the page to retry.');
    this.model=await response.json();
    this.referenceAngles=[...this.model.home];
    this.links=this.model.links.map(link=>{
      const group=new THREE.Group();group.name=link.name;group.matrixAutoUpdate=false;
      for(const surface of link.surfaces){
        if(surface.role==='branding')continue; // Keep the source mesh intact; omit painted lettering.

        const input=new THREE.BufferGeometry();
        input.setAttribute('position',new THREE.Float32BufferAttribute(surface.positions,3));
        const geometry=toCreasedNormals(input,Math.PI/5);
        const color=new THREE.Color().setRGB(...surface.color.slice(0,3),THREE.SRGBColorSpace);
        const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,metalness:.2,roughness:.38,side:THREE.DoubleSide}));
        mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
      }
      this.reference.add(group);return group;
    });
    this.setReferenceAngles(this.referenceAngles);
    // Deterministic geometric samples; no collision-free workspace claim.
    let seed=42;
    const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
    this.referenceRom=Array.from({length:240},()=>origin(referenceFrames(this.model,this.model.limits.map(([a,b])=>a+(b-a)*random())).at(-1)).toArray());
    this.canvas.dataset.modelLoaded='true';this.canvas.dataset.triangles=String(this.model.links.reduce((n,l)=>n+l.surfaces.filter(s=>s.role!=='branding').reduce((m,s)=>m+s.positions.length/9,0),0));
    this.reset();
  }

  setReferenceAngles(angles){
    if(angles.length!==6||angles.some((q,i)=>!Number.isFinite(q)||q<this.model.limits[i][0]||q>this.model.limits[i][1]))throw new Error('Reference joint angle outside limits.');
    this.referenceAngles=[...angles];this.referenceTransforms=referenceFrames(this.model,angles);
    this.links.forEach((link,i)=>link.matrix.copy(this.referenceTransforms[i]));
    this.reference.updateMatrixWorld(true);this.render();
  }

  clear(group){
    // Shared robot materials live for the viewer lifetime; transient geometry
    // and annotation materials must be released on every scene replacement.
    const shared=new Set(Object.values(this.materials));
    group.traverse(o=>{o.geometry?.dispose();if(o.material&&!shared.has(o.material)){o.material.map?.dispose();o.material.dispose();}});
    group.clear();
  }
  mesh(group,geometry,material,position=V()){
    const mesh=new THREE.Mesh(geometry,material);mesh.position.copy(position);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;
  }
  cylinder(group,a,b,r1,r2,material){
    const delta=b.clone().sub(a),length=delta.length();if(length<.00001)return;
    const mesh=this.mesh(group,new THREE.CylinderGeometry(r2,r1,length,32),material,a.clone().add(b).multiplyScalar(.5));
    mesh.quaternion.setFromUnitVectors(V(0,1,0),delta.normalize());return mesh;
  }
  box(group,size,position,material){return this.mesh(group,new THREE.BoxGeometry(...size),material,position);}
  casting(group,a,b,width,depth,material){
    const length=a.distanceTo(b);if(length<.015)return;
    // Tapered, chamfered casting with flat mounting faces and cast edge radii.
    const w=width/2,c=Math.min(.025,length*.12),s=new THREE.Shape();
    s.moveTo(-w+c,0);s.lineTo(w-c,0);s.lineTo(w,c);s.lineTo(w*.7,length-c);
    s.lineTo(w*.7-c,length);s.lineTo(-w*.7+c,length);s.lineTo(-w*.7,length-c);s.lineTo(-w,c);s.closePath();
    const geometry=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelThickness:.009,bevelSize:.009,bevelSegments:3,steps:1,curveSegments:12});
    geometry.translate(0,0,-depth/2);
    const mesh=this.mesh(group,geometry,material,a);
    mesh.quaternion.setFromUnitVectors(V(0,1,0),b.clone().sub(a).normalize());return mesh;
  }
  buildDesign(scene){
    this.clear(this.design);
    const f=scene.frames.map(matrix),p=f.map(origin),m=this.materials;
    const base=new THREE.Group();base.matrixAutoUpdate=false;base.matrix.copy(f[0]);this.design.add(base);
    const side=scene.family.base_size_m||.34;
    this.box(base,[side,side,.035],V(0,0,.0175),m.dark);
    this.cylinder(base,V(0,0,.035),V(0,0,.12),side*.38,side*.36,m.steel);
    for(const x of [-1,1])for(const y of [-1,1])this.cylinder(base,V(x*side*.39,y*side*.39,.036),V(x*side*.39,y*side*.39,.048),.012,.012,m.steel);
    for(let i=0;i<6;i++){
      const link=new THREE.Group();link.matrixAutoUpdate=false;link.matrix.copy(f[i+1]);this.design.add(link);
      const inv=f[i+1].clone().invert(),a=p[i].clone().applyMatrix4(inv),b=V();
      const width=[.23,.16,.15,.13,.10,.075][i]*(scene.family.reach_m/1.25)**.3;
      if(i===0)this.casting(link,a,b,width,width*.85,m.white);
      else this.casting(link,a,b,width,width*.64,m.white);
      // Joint housings follow the actual preceding DH z axis. Local geometry
      // follows the moving link frame, including axial wrist rotations.
      const axis=V(0,0,1).transformDirection(f[i]).transformDirection(inv);
      const center=a.clone();const r=width*.64;
      this.cylinder(link,center.clone().addScaledVector(axis,-width*.48),center.clone().addScaledVector(axis,width*.48),r,r,m.white);
      this.cylinder(link,center.clone().addScaledVector(axis,-width*.61),center.clone().addScaledVector(axis,-width*.49),r*.8,r*.8,m.dark);
      this.cylinder(link,center.clone().addScaledVector(axis,width*.49),center.clone().addScaledVector(axis,width*.55),r*.68,r*.68,m.steel);
      // Asymmetric servo cover makes wrist roll visible, not just its axis.
      const cover=this.box(link,[width*.7,width*.8,width*.45],center.clone().addScaledVector(axis,-width*.8),m.dark);
      cover.quaternion.setFromUnitVectors(V(0,0,1),axis);
    }
    const tool=new THREE.Group();tool.matrixAutoUpdate=false;tool.matrix.copy(f[6]);this.design.add(tool);
    this.cylinder(tool,V(0,0,-.012),V(0,0,.02),.042,.042,m.steel);
    const tcp=V(scene.tcp.x_m,scene.tcp.y_m,scene.tcp.z_m).applyMatrix4(f[6].clone().invert());
    // Display only an envelope of the selected tool, placed from the saved TCP.
    if(Math.abs(tcp.x)>.03){
      this.cylinder(tool,V(0,0,.02),V(0,0,tcp.z*.5),.032,.028,m.black);
      this.cylinder(tool,V(0,0,tcp.z*.5),tcp.clone().multiplyScalar(.86),.018,.015,m.steel);
      this.cylinder(tool,tcp.clone().multiplyScalar(.86),tcp,.016,.008,m.gold);
    }else{
      const length=Math.max(.06,tcp.z);
      this.box(tool,[.105,.065,length*.48],V(0,0,length*.3),m.dark);
      this.box(tool,[.12,.065,.026],V(0,0,length*.56),m.steel);
      for(const sign of [-1,1]){
        this.box(tool,[.017,.035,length*.40],V(sign*.043,0,length*.78),m.steel);
        this.box(tool,[.027,.04,.022],V(sign*.035,0,length*.96),m.black);
      }
    }
    this.design.updateMatrixWorld(true);
  }

  line(points,color,opacity=1){
    const geometry=new THREE.BufferGeometry().setFromPoints(points);
    const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity}));
    this.annotations.add(line);return line;
  }
  marker(position,color,radius=.012){return this.mesh(this.annotations,new THREE.SphereGeometry(radius,16,12),new THREE.MeshBasicMaterial({color}),position);}
  label(text,position){
    const c=document.createElement('canvas');c.width=96;c.height=48;
    const ctx=c.getContext('2d');ctx.font='600 26px Segoe UI';ctx.fillStyle='#f5ca8f';ctx.textAlign='center';ctx.fillText(text,48,32);
    const texture=new THREE.CanvasTexture(c);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false}));
    sprite.position.copy(position).add(V(0,0,.055));sprite.scale.set(.11,.055,1);this.annotations.add(sprite);
  }
  update(scene,cell,mode,showRom){
    if(!this.model||!scene)return;
    const changed=mode!==this.mode;this.mode=mode;this.currentScene=scene;
    this.reference.visible=mode==='reference';this.design.visible=mode==='design';
    if(mode==='design'&&this.lastDesignScene!==scene){this.buildDesign(scene);this.lastDesignScene=scene;}
    this.clear(this.annotations);
    if(showRom){
      const points=mode==='reference'?this.referenceRom:scene.rom_points;
      const geometry=new THREE.BufferGeometry().setFromPoints((points||[]).map(p=>V(...p)));
      this.annotations.add(new THREE.Points(geometry,new THREE.PointsMaterial({color:0xb5edb2,size:.012,transparent:true,opacity:.3,depthWrite:false})));
    }
    if(mode==='design'){
      for(const o of cell.obstacles){
        const box=this.mesh(this.annotations,new THREE.BoxGeometry(...o.size_m),new THREE.MeshStandardMaterial({color:0xdb9d59,transparent:true,opacity:.16,depthWrite:false}));
        box.applyMatrix4(pose(o.pose));box.castShadow=false;
        const edges=new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry),new THREE.LineBasicMaterial({color:0xdb9d59}));edges.applyMatrix4(pose(o.pose));this.annotations.add(edges);
      }
      const tasks=cell.task_poses.map(t=>V(t.pose.x_m,t.pose.y_m,t.pose.z_m));
      if(tasks.length>1)this.line(tasks,0xefb66c,.6);
      tasks.forEach((p,i)=>{this.marker(p,0xefb66c);this.label('P'+(i+1),p);});
      const tcp=V(scene.tcp.x_m,scene.tcp.y_m,scene.tcp.z_m);this.marker(tcp,0xefb66c,.008);
    }
    const frame=mode==='reference'?this.referenceTransforms.at(-1):matrix(scene.frames[6]);
    const axes=new THREE.AxesHelper(.12);axes.applyMatrix4(frame);this.annotations.add(axes);
    this.canvas.dataset.mode=mode;this.canvas.dataset.renderState='ready';
    if(changed||this.needsFit)this.reset();else this.render();
  }

  resize(){
    const w=this.canvas.clientWidth,h=this.canvas.clientHeight;if(!w||!h)return;
    this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);
  }
  reset(){
    this.resize();const object=this.mode==='reference'?this.reference:this.design;
    object.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(object);
    if(bounds.isEmpty())return;
    const center=bounds.getCenter(V()),size=bounds.getSize(V());
    // The sphere fit handles tall mobile canvases and wide desktop canvases.
    const radius=size.length()/2;
    const halfV=THREE.MathUtils.degToRad(this.camera.fov/2);
    const halfH=Math.atan(Math.tan(halfV)*this.camera.aspect);
    const distance=radius/Math.sin(Math.min(halfV,halfH))*1.08;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(V(2.6,4,2.1).normalize().multiplyScalar(distance));
    this.controls.update();this.needsFit=false;this.render();
  }
  render(){if(this.canvas.clientWidth&&this.canvas.clientHeight)this.renderer.render(this.world,this.camera);}
}
