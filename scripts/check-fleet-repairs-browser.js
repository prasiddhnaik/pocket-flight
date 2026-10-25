async (page) => {
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.setViewportSize({width:1100,height:800});await page.waitForFunction(()=>window.ready);
 const shots=[];
 for(const id of ['finch','peregrine','stormbird']) {
  for(const view of ['front','left','right','rear','top','underside','gear','cockpit']) {
   const info=await page.evaluate(({id,view})=>window.review(id,-1,view),{id,view});
   const path=`output/fleet-attachment-repair/${id}-${view}.png`;await page.locator('canvas').screenshot({path});shots.push({id,view,time:-1,path,...info});
  }
  for(const [time,view]of [[5,'gear'],[12,'gear'],[18,'cockpit'],[28,'underside']]) {
   const info=await page.evaluate(({id,time,view})=>window.review(id,time,view),{id,time,view});const path=`output/fleet-attachment-repair/${id}-${view}-${time}.png`;await page.locator('canvas').screenshot({path});shots.push({id,view,time,path,...info});
  }
 }
 if(errors.length)throw new Error(JSON.stringify(errors));return{shots,errors};
}
