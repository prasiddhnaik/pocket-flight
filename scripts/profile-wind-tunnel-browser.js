async page => {
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.reload();await page.setViewportSize({width:1440,height:1000});
  const results=[];
  for(const [id,name] of [['finch','Finch U–2'],['peregrine','Peregrine HX–27'],['aurelia','Aurelia S32'],['stormbird','Stormbird HX–40']]) {
    await page.getByRole('combobox',{name:'Aircraft',exact:true}).selectOption(id);
    await page.getByRole('status').filter({hasText:`${name} ready`}).waitFor();
    const sample=async()=>page.evaluate(async()=>{const spans=[];let begin=performance.now(),last=begin;await new Promise(done=>{function frame(t){spans.push(t-last);last=t;if(t-begin<1800)requestAnimationFrame(frame);else done();}requestAnimationFrame(frame)});spans.sort((a,b)=>a-b);return {fps:spans.length*1000/(last-begin),p95Ms:spans[Math.floor(spans.length*.95)],...window.windTunnel.getState().performance};});
    const active=await sample();
    const updates=[];
    for(let i=0;i<5;i++) {await page.getByRole('slider',{name:'Airspeed',exact:true}).press('ArrowRight');await page.waitForFunction(n=>window.windTunnel.getState().conditions.speed===n,31+i);updates.push(await page.evaluate(()=>window.windTunnel.getState().performance));}
    await page.getByRole('slider',{name:'Angle of attack',exact:true}).press('ArrowRight');
    await page.waitForFunction(()=>window.windTunnel.getState().conditions.alpha===4.5);
    await page.getByRole("status").filter({hasText:`${name} ready`}).waitFor();
    const angle=await page.evaluate(()=>window.windTunnel.getState().performance);
    await page.getByRole('button',{name:'Pause flow animation',exact:true}).click();
    const paused=await sample();
    await page.getByRole('button',{name:'Resume flow animation',exact:true}).click();
    results.push({id,active,updates,angle,paused});
    // Restore using native range keyboard input.
    await page.getByRole('slider',{name:'Angle of attack',exact:true}).press('ArrowLeft');
    for(let i=0;i<5;i++)await page.getByRole('slider',{name:'Airspeed',exact:true}).press('ArrowLeft');
  }
  return {results,errors,viewport:[1440,1000],renderer:'Chromium Metal',generatedAt:new Date().toISOString()};
}
