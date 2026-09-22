import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
const $=s=>document.querySelector(s),host=$('#canvas');
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.85;host.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#10151c');scene.fog=new THREE.FogExp2('#10151c',.019);
const camera=new THREE.PerspectiveCamera(42,1,.1,180);camera.position.set(0,0,23);
const pmrem=new THREE.PMREMGenerator(renderer);const environment=new RoomEnvironment();scene.environment=pmrem.fromScene(environment,.04).texture;environment.dispose();pmrem.dispose();
scene.environmentIntensity=.65;scene.add(new THREE.HemisphereLight(0xdceaff,0x252733,.8));const key=new THREE.DirectionalLight(0xffffff,2.5);key.position.set(-5,8,6);scene.add(key);const rim=new THREE.PointLight(0x557cff,75,35);rim.position.set(7,0,4);scene.add(rim);
const palette=new THREE.MeshPhysicalMaterial({color:'#2449ff',metalness:.22,roughness:.19,clearcoat:1,clearcoatRoughness:.13});const porcelain=new THREE.MeshPhysicalMaterial({color:'#e1e4e8',metalness:.12,roughness:.26,clearcoat:.7});const graphite=new THREE.MeshPhysicalMaterial({color:'#171a21',metalness:.4,roughness:.22,clearcoat:1});
const root=new THREE.Group();scene.add(root);const objects=[];let seed=15;function random(){seed=(seed*16807)%2147483647;return(seed-1)/2147483646}
const ring=new THREE.Shape();ring.absarc(0,0,.47,0,Math.PI*2,false);const hole=new THREE.Path();hole.absarc(0,0,.17,0,Math.PI*2,true);ring.holes.push(hole);const tube=new THREE.ExtrudeGeometry(ring,{depth:2.3,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.07,bevelThickness:.07,curveSegments:28});tube.translate(0,0,-1.15);const core=new THREE.SphereGeometry(.5,24,16);
function addObject(x,y,born=false){const g=new THREE.Group(),mat=[palette,palette,porcelain,graphite][objects.length%4];g.add(new THREE.Mesh(core,mat));for(let i=0;i<3;i++){const m=new THREE.Mesh(tube,mat);if(i===0)m.rotation.y=Math.PI/2;if(i===1)m.rotation.x=Math.PI/2;g.add(m)}const index=objects.length;let pos=new THREE.Vector3(x??(random()-.5)*17,y??(random()-.5)*10-1,(random()-.5)*8);g.position.copy(pos);g.rotation.set(random()*3,random()*3,random()*3);let size=.85+random()*.85;g.scale.setScalar(born?.01:size);root.add(g);objects.push({g,pos,size,age:born?0:1,phase:random()*6.28});$('#count').textContent=String(objects.length).padStart(3,'0')+' OBJECTS';if(objects.length>54){root.remove(objects.shift().g)}}for(let i=0;i<24;i++)addObject();
const n=9000,positions=new Float32Array(n*3),targets=new Float32Array(n*3),offsets=new Float32Array(n);for(let i=0;i<n;i++){const u=random()*Math.PI*2,v=Math.acos(2*random()-1),r=5.3+random()*.4;positions[i*3]=Math.sin(v)*Math.cos(u)*r;positions[i*3+1]=Math.cos(v)*r;positions[i*3+2]=Math.sin(v)*Math.sin(u)*r;targets[i*3]=positions[i*3];targets[i*3+1]=positions[i*3+1];targets[i*3+2]=positions[i*3+2];offsets[i]=random()*6.28}
const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));const particleMat=new THREE.PointsMaterial({color:'#8eaaff',size:.065,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});const particles=new THREE.Points(geometry,particleMat);scene.add(particles);
const journey=$('#journey'),stage=$('#stage'),stageWrap=$('.stage-wrap');
let progress=0,smooth=0,shape=0,paused=matchMedia('(prefers-reduced-motion: reduce)').matches,time=0,px=0,py=0,drag=0,down=null,pulse=0;
// Resizing a WebGL drawing buffer clears it. Queue real viewport changes and
// apply them immediately before rendering; never resize in a ResizeObserver callback.
let resizePending=true,viewWidth=1,viewHeight=1,lastChapter=-1,lastDepth=-1;
function resize(){
  const width=Math.max(1,Math.round(host.clientWidth)),height=Math.max(1,Math.round(host.clientHeight));
  if(width!==viewWidth||height!==viewHeight){
    viewWidth=width;viewHeight=height;
    renderer.setSize(width,height,false);
    camera.aspect=width/height;
    camera.updateProjectionMatrix();
  }
  resizePending=false;
}
new ResizeObserver(()=>{resizePending=true}).observe(host);
addEventListener('resize',()=>{resizePending=true},{passive:true});
// Read scroll position in the render loop, including layout changes from fonts,
// orientation and resizing. The stable sticky viewport never changes its layout.
function scroll(){const r=journey.getBoundingClientRect();progress=THREE.MathUtils.clamp(-r.top/Math.max(1,r.height-stageWrap.clientHeight),0,1)}
particles.frustumCulled=false; // Morphing positions invalidate the initial bounding sphere.
host.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,last:e.clientX};});addEventListener('pointerup',e=>{if(!down)return;const distance=Math.hypot(e.clientX-down.x,e.clientY-down.y);down=null;if(distance>7)return;const rect=host.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*2-1,y=-(e.clientY-rect.top)/rect.height*2+1;if(e.clientY<rect.top||e.clientY>rect.bottom)return;const p=new THREE.Vector3(x,y,.5).unproject(camera),dir=p.sub(camera.position).normalize();p.copy(camera.position).add(dir.multiplyScalar(-camera.position.z/dir.z));root.worldToLocal(p);addObject(p.x,p.y,true);pulse=1;const f=$('#feedback');f.style.left=e.clientX-rect.left+15+'px';f.style.top=e.clientY-rect.top-20+'px';f.textContent=smooth>.5?'+ ENERGY RELEASED':'+ MATTER CREATED';f.style.opacity=1;setTimeout(()=>f.style.opacity=0,1100)});
host.addEventListener('pointermove',e=>{const r=host.getBoundingClientRect();px=(e.clientX-r.left)/r.width-.5;py=(e.clientY-r.top)/r.height-.5;if(down){drag+=(e.clientX-down.last)*.004;down.last=e.clientX}$('#coords').textContent=`X ${px.toFixed(2)} / Y ${py.toFixed(2)}`});
document.querySelectorAll('.swatch').forEach(b=>b.onclick=()=>{palette.color.set(b.dataset.color);particleMat.color.set(b.dataset.color);rim.color.set(b.dataset.color);document.querySelector('.selected').classList.remove('selected');b.classList.add('selected');pulse=1});
$('#shape').onclick=()=>{shape=(shape+1)%3;$('#shape').textContent=['形态：聚合 ↗','形态：轨道 ↗','形态：展开 ↗'][shape];pulse=.7};$('#pause').textContent=paused?'▶':'Ⅱ';$('#pause').onclick=()=>{paused=!paused;$('#pause').textContent=paused?'▶':'Ⅱ';$('#pause').setAttribute('aria-label',paused?'播放动画':'暂停动画')};function reset(){while(objects.length){root.remove(objects.pop().g)}seed=15;for(let i=0;i<24;i++)addObject();shape=0;drag=0;$('#shape').textContent='形态：聚合 ↗';window.scrollTo({top:0,behavior:'smooth'})}$('#reset').onclick=reset;$('#again').onclick=()=>$('#journey').scrollIntoView({behavior:'smooth'});
const clock=new THREE.Clock();function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);
if(resizePending)resize();scroll();
if(!paused)time+=dt;
const follow=1-Math.exp(-9*dt),morph=1-Math.exp(-4*dt);
smooth+=(progress-smooth)*follow;pulse*=Math.exp(-3*dt);
const dive=THREE.MathUtils.smoothstep(smooth,.27,.88),expand=THREE.MathUtils.smoothstep(smooth,0,.3);
// Reveal a full-size canvas with clipping. No animated padding, layout feedback,
// drawing-buffer reallocations or aspect changes while scrolling.
const insetX=viewWidth*.04*(1-expand),insetY=18*(1-expand);
stage.style.clipPath=`inset(${insetY}px ${insetX}px 0 round ${24*(1-expand)}px)`;
const depth=Math.round(smooth*120);if(depth!==lastDepth){$('#depth').textContent='DEPTH '+String(depth).padStart(3,'0');lastDepth=depth}
const chapter=smooth<.34?0:smooth<.72?1:2;
if(chapter!==lastChapter){$('#chapter').textContent=['01 / PLAY','02 / ENTER','03 / BECOME'][chapter];$('#stage-heading').textContent=['Nothing stands still.','Beyond the surface.','Everything is connected.'][chapter];$('#stage-copy').textContent=['点击空白处，给这个世界一点新物质。','继续下潜。让边界退去，让空间展开。','切换形态，改变粒子的组织方式。'][chapter];lastChapter=chapter}

root.rotation.y=drag+px*.13+time*.055;root.rotation.x=py*.07;// Keep every object in front of the camera throughout the journey. As particles
// gather, solids contract into a persistent inner constellation instead of popping off.
root.position.z=dive*3;
const framing=Math.min(1,Math.max(.52,camera.aspect/1.3));
root.scale.setScalar(framing*(1-dive*.37));
objects.forEach((o,i)=>{o.age=Math.min(1,o.age+dt*2);const born=1-Math.pow(1-o.age,3),orbit=i/objects.length*Math.PI*2;const spread=shape===2?1.5:1;const tx=shape===1?Math.cos(orbit)*7:o.pos.x*spread,ty=shape===1?Math.sin(orbit)*4:o.pos.y*spread;o.g.position.x+=(tx-o.g.position.x)*morph;o.g.position.y+=(ty+Math.sin(time*.4+o.phase)*.3-o.g.position.y)*morph;o.g.rotation.x+=paused?0:dt*.10;o.g.rotation.z+=paused?0:dt*.07;o.g.scale.setScalar(o.size*born*(1+pulse*.12)*(1-dive*.76));});
particleMat.opacity=.12+dive*.88;particles.rotation.y=time*.07+drag*.3;particles.rotation.x=py*.1;particles.position.z=-2+dive*4;particles.scale.setScalar(framing*(.9+dive*.2));for(let i=0;i<n;i++){let x=targets[i*3],y=targets[i*3+1],z=targets[i*3+2];if(shape===1){const a=offsets[i],r=4.8+(i%80)/55;x=Math.cos(a)*r;y=Math.sin(a)*r*.33;z=Math.sin(a)*r}else if(shape===2){x*=2;y=y*.6+Math.sin(x*.7+time)*.8;z*=1.4}const wave=Math.sin(time+offsets[i])* .08+pulse*.8;positions[i*3]+=(x*(1+wave)-positions[i*3])*morph;positions[i*3+1]+=(y*(1+wave)-positions[i*3+1])*morph;positions[i*3+2]+=(z*(1+wave)-positions[i*3+2])*morph}geometry.attributes.position.needsUpdate=true;camera.position.x+=(px*.8-camera.position.x)*morph;camera.position.y+=(-py*.5-camera.position.y)*morph;camera.lookAt(0,0,0);renderer.render(scene,camera)}animate();
