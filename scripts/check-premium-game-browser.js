async page => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewportSize({width:1100,height:760});
  const results=[];
  for (const id of ['finch','peregrine','aurelia','stormbird']) {
    await page.getByRole('combobox',{name:'Choose aircraft'}).selectOption(id);
    await page.getByRole('button',{name:'Free flight',exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(id=>window.pocketFlight.getState().aircraft===id,id);
    await page.getByRole('button',{name:'Free flight',exact:true}).click();
    await page.waitForFunction(()=>window.pocketFlight.getState().mode==='playing');
    const before=await page.evaluate(()=>window.pocketFlight.getState());
    await page.keyboard.down('Shift');
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(()=>Math.abs(window.pocketFlight.getState().roll)>.25,{},{timeout:60000});
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('Shift');
    const bank=await page.evaluate(()=>window.pocketFlight.getState());
    await page.screenshot({path:`output/premium-game-${id}.png`});
    await page.waitForFunction(()=>Math.abs(window.pocketFlight.getState().roll)<.08,{},{timeout:60000});
    const recovered=await page.evaluate(()=>window.pocketFlight.getState());
    if (recovered.crashed || recovered.grounded || bank.health!==100 || bank.enginePower>=bank.throttle || before.beginnerAssist!==true) throw new Error(`${id} control flight failed: ${JSON.stringify({before,bank,recovered})}`);
    results.push({id,before,bank,recovered});
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Back to the island',exact:true}).click();
  }
  if(errors.length) throw new Error(errors.join('\n'));
  return {results,errors};
}
