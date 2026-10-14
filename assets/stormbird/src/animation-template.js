// Generated from CAD datums by export_transfer.py; fixed-length parts rotate about pins.
const data = __MECHANISMS__;
const refs = __REFS__;
const smooth = (a,b,t) => { const x=Math.max(0,Math.min(1,(t-a)/(b-a))); return x*x*(3-2*x); };
const add = (a,b) => a.map((v,i)=>v+b[i]);
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const mul = (a,s) => a.map(v=>v*s);
const norm = a => Math.hypot(...a);
const rotate = (p,o,degrees) => {
  const [x,y,z]=sub(p,o), t=degrees*Math.PI/180, c=Math.cos(t),s=Math.sin(t);
  return add([x,y*c-z*s,y*s+z*c],o);
};
const swing = (m,name,axis,angle,point) => m.get(refs[name]).rotate(axis,angle,mul(point,1000));
function segment(m,name,a,b) {
  const [ra,rb]=data.segments[name], u=sub(rb,ra),v=sub(b,a);
  const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const dot=u.reduce((sum,n,i)=>sum+n*v[i],0)/(norm(u)*norm(v));
  const part=m.get(refs[name]);
  if(norm(cross)>1e-10) part.rotate(mul(cross,1/norm(cross)),Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI,mul(ra,1000));
  part.translate(mul(sub(a,ra),1000));
}
function ram(m,name,a,b,barrel,rod) {
  const direction=mul(sub(b,a),1/norm(sub(b,a)));
  segment(m,name+'_barrel',a,add(a,mul(direction,barrel)));
  segment(m,name+'_piston',sub(b,mul(direction,rod)),b);
}
function pose(m,phase,canopy) {
  const angle=smooth(0,1,canopy)*data.canopy.angle;
  swing(m,data.canopy.name,data.canopy.axis,angle,data.canopy.point);
  for(const [side,label] of [[-1,'Left'],[1,'Right']])
    ram(m,'Canopy_actuator_'+label,[side*.30,3.39,2.33],rotate([side*.30,4.03,2.575],data.canopy.point,angle),.60,.68);
  for(const door of data.doors)
    swing(m,door.name,door.axis,-smooth(.90,1,phase)*door.open_angle,door.point);
  for(const leg of data.legs) {
    const angle=smooth(leg.start,leg.end,phase)*leg.angle;
    if(leg.swivel) swing(m,leg.swivel.name,leg.swivel.axis,
      smooth(.30,.75,phase)*leg.swivel.angle,leg.swivel.point);
    swing(m,leg.name,leg.axis,angle,leg.point);
    const a=data.segments[leg.name+'_brace_upper'][0],
      b=rotate(data.segments[leg.name+'_brace_lower'][1],leg.point,angle);
    const d=sub(b,a),l=norm(d),h=Math.sqrt(Math.max(0,leg.brace_length**2-l*l/4))*(leg.brace_branch??1);
    const elbow=add(mul(add(a,b),.5),[0,-d[2]*h/l,d[1]*h/l]);
    segment(m,leg.name+'_brace_upper',a,elbow); segment(m,leg.name+'_brace_lower',elbow,b);
    const barrel=data.segments[leg.name+'_actuator_barrel'], rod=data.segments[leg.name+'_actuator_piston'];
    ram(m,leg.name+'_actuator',barrel[0],rotate(rod[1],leg.point,angle),
        norm(sub(barrel[1],barrel[0])),norm(sub(rod[1],rod[0])));
  }
}
export const clips = {
  canopy: { label: 'Canopy · hinged lift', duration: 8.4, loop: true,
    update(t,m) { const p=t<3.2?t/3.2:t<4.2?1:t<7.4?1-(t-4.2)/3.2:0; pose(m,0,p); } },
  gear: { label: 'Gear · doors / retract / close', duration: 12.6, loop: true,
    update(t,m) { const p=t<4.8?t/4.8:t<6.3?1:t<11.1?1-(t-6.3)/4.8:0; pose(m,p,0); } },
};
