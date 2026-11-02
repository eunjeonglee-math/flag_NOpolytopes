/* Full low-dimensional polytope in an orthonormal basis of its affine span. */
(function(root){
  'use strict';
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),minus=(a,b)=>a.map((x,i)=>x-b[i]);
  function coordinates(g){
    const vertices=g.approximate_vertices,ambient=vertices[0].length,dim=g.dimension;
    if(ambient<=3&&ambient===dim)return {map:v=>[v[0]||0,v[1]||0,v[2]||0],labels:['x₁','x₂','x₃'],intrinsic:false};
    const basis=[];
    for(const v of vertices){let a=minus(v,vertices[0]);for(const b of basis){const t=dot(a,b);a=a.map((x,i)=>x-t*b[i]);}const norm=Math.sqrt(dot(a,a));if(norm>1e-9)basis.push(a.map(x=>x/norm));if(basis.length===dim)break;}
    return {map:v=>[0,1,2].map(i=>basis[i]?dot(minus(v,vertices[0]),basis[i]):0),labels:['u₁','u₂','u₃'],intrinsic:true};
  }
  function mount(svg,controls){
    const NS='http://www.w3.org/2000/svg';let record=null,frame=null,yaw=-.65,pitch=-.5,drag=null,scheduled=false,justDragged=false;
    function shape(parent,tag,attrs,text){const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;parent.append(e);return e;}
    function rotation(p){if(record.geometry.dimension<3)return [p[0],p[1],0];const a=p[0]*Math.cos(yaw)-p[1]*Math.sin(yaw),b=p[0]*Math.sin(yaw)+p[1]*Math.cos(yaw);return [a,p[2]*Math.cos(pitch)-b*Math.sin(pitch),p[2]*Math.sin(pitch)+b*Math.cos(pitch)];}
    function draw(){
      scheduled=false;if(!frame)return;const g=record.geometry;svg.replaceChildren();
      const rotated=frame.vertices.map(v=>rotation(minus(v,frame.center)));
      const xy=p=>[270+p[0]*frame.scale,165-p[1]*frame.scale];
      const points=rotated.map(xy),layer=shape(svg,'g',{'data-layer':'polytope'});
      function polygon(ids){const center=[0,1,2].map(k=>ids.reduce((s,i)=>s+frame.vertices[i][k],0)/ids.length),u=minus(frame.vertices[ids[0]],center);let normal;
        for(const id of ids.slice(1)){const v=minus(frame.vertices[id],center),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(dot(cross,cross)>1e-12){normal=cross;break;}}
        if(!normal)return ids;const second=[normal[1]*u[2]-normal[2]*u[1],normal[2]*u[0]-normal[0]*u[2],normal[0]*u[1]-normal[1]*u[0]],un=Math.sqrt(dot(u,u)),vn=Math.sqrt(dot(second,second));
        return ids.slice().sort((a,b)=>{const va=minus(frame.vertices[a],center),vb=minus(frame.vertices[b],center);return Math.atan2(dot(va,second)/vn,dot(va,u)/un)-Math.atan2(dot(vb,second)/vn,dot(vb,u)/un);});
      }
      const faces=g.dimension===2?[g.vertices.map((_,i)=>i)]:g.faces||[];
      for(const face of faces)shape(layer,'polygon',{points:polygon(face).map(i=>points[i].join(',')).join(' '),fill:'#b4c4e5','fill-opacity':g.dimension===2?.13:.09,stroke:'none'});
      for(const [a,b] of g.edges)shape(layer,'line',{x1:points[a][0],y1:points[a][1],x2:points[b][0],y2:points[b][1],stroke:'#7782a6','stroke-width':1.4});
      const dots=shape(svg,'g',{'data-layer':'lattice'}),lattice=record.lattice;
      if(lattice?.status==='complete'){
        const positions=lattice.points.map((v,i)=>({i,rot:rotation(minus(frame.coordinates.map(v),frame.center))})).sort((a,b)=>a.rot[2]-b.rot[2]);
        const radius=lattice.total>3000?1.7:lattice.total>500?2.6:3.8;
        for(const {i,rot} of positions){const p=xy(rot),kind=lattice.kinds[i],exact='['+lattice.points[i].join(', ')+']',description=exact+' · '+(kind==='interior'?'relative interior':'boundary');
          const dot=shape(dots,'circle',{cx:p[0],cy:p[1],r:radius,fill:kind==='interior'?'#bd527c':'#287f92','data-kind':kind,'data-coordinates':exact});
          shape(dot,'title',{},description);dot.addEventListener('click',()=>{if(!justDragged)controls.info.textContent=description;});
        }
      }
      const vertices=shape(svg,'g',{'data-layer':'vertices','pointer-events':'none'});
      points.forEach((p,i)=>{const c=shape(vertices,'circle',{cx:p[0],cy:p[1],r:5.5,fill:'none',stroke:'#73609a','stroke-width':1.5});shape(c,'title',{},'Vertex ['+g.vertices[i].join(', ')+']');});
      const axes=shape(svg,'g',{'aria-hidden':'true'}),base=[48,280];
      for(let j=0;j<g.dimension;j++){const v=rotation([0,1,2].map(k=>k===j?1:0)),end=[base[0]+v[0]*27,base[1]-v[1]*27];shape(axes,'line',{x1:base[0],y1:base[1],x2:end[0],y2:end[1],stroke:'#9aa7b6','stroke-width':1});shape(axes,'text',{x:end[0]+3,y:end[1]-3,fill:'#68798b','font-size':10},frame.coordinates.labels[j]);}
      svg.dataset.yaw=String(yaw);svg.dataset.pitch=String(pitch);
    }
    function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(draw);}}
    function reset(){yaw=-.65;pitch=-.5;controls.slider.value=String((yaw*180/Math.PI%360+360)%360);schedule();}
    controls.slider.addEventListener('input',()=>{yaw=Number(controls.slider.value)*Math.PI/180;schedule();});controls.reset.addEventListener('click',reset);
    svg.addEventListener('pointerdown',e=>{if(!frame||record.geometry.dimension!==3||e.button!==0)return;const point=e.target.closest('circle[data-coordinates]');drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,point:point?point.dataset.coordinates+' · '+(point.dataset.kind==='interior'?'relative interior':'boundary'):null};justDragged=false;svg.setPointerCapture(e.pointerId);svg.classList.add('dragging');});
    svg.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;yaw+=dx*.009;pitch=Math.max(-1.5,Math.min(1.5,pitch+dy*.009));drag.x=e.clientX;drag.y=e.clientY;justDragged=Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>3;controls.slider.value=String((yaw*180/Math.PI%360+360)%360);schedule();});
    function release(e){if(!drag||drag.id!==e.pointerId)return;if(e.type==='pointerup'&&!justDragged&&drag.point)controls.info.textContent=drag.point;drag=null;svg.classList.remove('dragging');if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);}
    svg.addEventListener('pointerup',release);svg.addEventListener('pointercancel',release);svg.addEventListener('lostpointercapture',()=>{drag=null;svg.classList.remove('dragging');});
    svg.addEventListener('keydown',e=>{if(!frame||record.geometry.dimension!==3)return;const keys={ArrowLeft:[-.12,0],ArrowRight:[.12,0],ArrowUp:[0,-.12],ArrowDown:[0,.12]};if(keys[e.key]){e.preventDefault();yaw+=keys[e.key][0];pitch=Math.max(-1.5,Math.min(1.5,pitch+keys[e.key][1]));schedule();}else if(e.key==='Home'){e.preventDefault();reset();}});
    return {set(data){record=data;const g=data.geometry;frame=null;svg.replaceChildren();if(g.status!=='complete'||g.dimension>3)return;
      const c=coordinates(g),vertices=g.approximate_vertices.map(c.map),center=[0,1,2].map(j=>(Math.min(...vertices.map(v=>v[j]))+Math.max(...vertices.map(v=>v[j])))/2);
      const radius=Math.max(.6,...vertices.map(v=>Math.sqrt(dot(minus(v,center),minus(v,center)))));
      frame={vertices,center,coordinates:c,scale:125/radius};svg.classList.toggle('rotatable',g.dimension===3);svg.setAttribute('tabindex',g.dimension===3?'0':'-1');
      controls.info.textContent='Hover over a point, or click it, to read its original string coordinates.';
      controls.note.textContent=(g.dimension===3?'Drag to rotate · arrow keys also rotate · Home resets the view. ':g.dimension===0?'The polytope is a single point. ':'')+(c.intrinsic?'Shown in an orthonormal basis of its affine span. ':'')+'Interior means relative interior.';
      reset();draw();
    }};
  }
  root.NObyStringPlot={mount,coordinates};
  if(typeof module==='object'&&module.exports)module.exports={coordinates};
})(globalThis);
