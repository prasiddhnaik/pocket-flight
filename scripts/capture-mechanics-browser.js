async page => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('combobox', { name: 'Aircraft', exact: true }).selectOption('stormbird');
  await page.getByRole('status').filter({ hasText: 'Stormbird HX–40 ready' }).waitFor();
  await page.getByRole('combobox', { name: 'Systems programme', exact: true }).selectOption('gear');
  const slider = page.getByRole('slider', { name: 'Mechanism cycle', exact: true });
  await slider.press('End');
  await page.getByRole('button', { name: 'Gear close-up', exact: true }).click();
  await slider.press('Home');
  for (let i = 0; i < 6; i++) await slider.press('PageUp');
  await page.getByRole('button', { name: 'Resume mechanisms', exact: true }).click();
  const before = await page.evaluate(() => window.windTunnel.getState().performance.mechanics);
  const recording = await page.evaluate(async () => {
    const canvas = document.querySelector('.canvas-host canvas');
    const stream = canvas.captureStream(30), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2500000 });
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start(); await new Promise(resolve => setTimeout(resolve, 10000)); recorder.stop(); await done;
    stream.getTracks().forEach(track => track.stop());
    const blob = new Blob(chunks, { type: 'video/webm' });
    return await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
  });
  const after = await page.evaluate(() => window.windTunnel.getState().performance.mechanics);
  await page.screenshot({ path: 'output/mechanics-stormbird-recording.png' });
  return { before, after, recording };
}
