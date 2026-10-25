// Run from the repository root with RAED_PLAYWRIGHT pointing to Playwright.
// Read-only browser checks: all joint/reference edits are transient previews.
const {chromium}=require(process.env.RAED_PLAYWRIGHT||'C:/Users/DELL 2/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
  const output=process.env.RAED_VIEWER_OUTPUT||'tmp/viewer-verification';fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1536,height:1100}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const bad=[];page.on('response',r=>{if(r.status()>=400)bad.push([r.status(),r.url()]);});
    await page.goto(process.env.RAED_URL||'http://127.0.0.1:8765/');
    await page.waitForSelector('#robot-canvas[data-render-state="ready"]');
    const canvas=page.locator('#robot-canvas');
    assert.equal(await canvas.getAttribute('data-triangles'),'1952');
    assert.equal(await canvas.getAttribute('data-mode'),'reference');
    assert.equal(await page.locator('#add-task').isDisabled(),true);
    await canvas.screenshot({path:output+'/up6-home.png'});
    const initial=await page.locator('#tcp-label').textContent();
    assert.equal(initial,'Flange 0.790 / 0.000 / 1.055 m');
    for(let i=0;i<6;i++){
      await page.locator(`[data-joint="${i}"]`).fill(String([.55,.45,-.45,.4,.6,.7][i]));
      await page.locator(`[data-joint="${i}"]`).dispatchEvent('input');
    }
    assert.notEqual(await page.locator('#tcp-label').textContent(),initial);
    await canvas.screenshot({path:output+'/up6-articulated.png'});
    await page.locator('#home-pose').click();
    assert.equal(await page.locator('#tcp-label').textContent(),initial);
    await page.locator('#show-rom').check();
    await canvas.screenshot({path:output+'/up6-range.png'});
    await page.locator('#show-rom').uncheck();
    await page.locator('#model-select').selectOption('design');
    assert.equal(await canvas.getAttribute('data-mode'),'design');
    assert.equal(await page.locator('#add-task').isEnabled(),true);
    await page.locator('#add-task').click();await page.locator('#add-obstacle').click();
    await canvas.screenshot({path:output+'/design-solid.png'});
    await page.locator('#model-select').selectOption('reference');
    for(const width of [768,390]){
      await page.setViewportSize({width,height:1000});await page.locator('#reset-view').click();
      await canvas.screenshot({path:output+`/up6-${width}.png`});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow at ${width}`);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);
    console.log(JSON.stringify({ok:true,triangles:1952,articulation:'6 joints',screenshots:output,errors,bad}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
