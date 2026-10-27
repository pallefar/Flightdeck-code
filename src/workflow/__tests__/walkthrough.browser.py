"""18 isolated real-Chromium groups; run with browser_exec.
No vendor requests, deployment, credentials, approvals or adapter execution.
"""
import json
import time
from pathlib import Path
from typing import Any, cast
from browser_harness.helpers import goto_url, wait_for_load, cdp, js, capture_screenshot  # pyright: ignore[reportMissingImports]
RESULTS=Path('/Users/te451223/.hermes/cache/scratch/workflow-walkthrough-browser-results.json')
results={}
def record(name,value):
    assert name not in results,name
    results[name]=value
    RESULTS.write_text(json.dumps(results,indent=2))
    print(json.dumps({'group':name,'status':'PASS','result':value}))
def check(expression,message):
    assert js(expression),message
def settle(): time.sleep(.12)
def key(value):
    cdp('Input.dispatchKeyEvent',type='keyDown',key=value,code=value,text='\r' if value=='Enter' else '',windowsVirtualKeyCode={'Tab':9,'Enter':13,'Escape':27}.get(value,0))
    cdp('Input.dispatchKeyEvent',type='keyUp',key=value,code=value)
    settle()
def focus_button(text,scope='window.nativeFixture.container'):
    js(f"(()=>{{const b=window.walkthroughTests.button({scope},{json.dumps(text)});b.scrollIntoView({{block:'nearest'}});b.focus();}})()")
def mount(reveal=False):
    js(f'window.nativeFixture=window.walkthroughTests.fixture({{reveal:{str(reveal).lower()}}});true')
    settle()
def dispose():
    js('window.nativeFixture.dispose();window.nativeFixture=null')

cdp('Emulation.setDeviceMetricsOverride',width=1280,height=577,deviceScaleFactor=1,mobile=False)
goto_url('http://127.0.0.1:5180/src/workflow/__tests__/walkthrough.html')
wait_for_load()
cdp('Page.bringToFront')
for name,expression,reduced in [
    ('guided-controls','guidedControls()',False),
    ('narration-privacy-bridge','narrationPrivacy()',False),
    ('100-node-creation','creationMaximum()',False),
    ('hidden-retention','navigationPause("hidden")',False),
    ('inactive-retention','navigationPause("inactive")',False),
    ('modified-graph-cancellation','modifiedGraphStops()',False),
    ('settings-retention','settingsRetained()',False),
    ('reduced-motion-manual','reducedMotionManual()',True),
    ('motion-off-manual','motionOffManual()',False),
    ('view-only-operations','viewOperations()',False),
    ('node-deletion','deletionStops()',False),
    ('actual-local-trace-unchanged','localExecutionUnchanged()',False),
    ('resource-reference-one-undo','resourceReferenceInsertion()',False),
]:
    cdp('Emulation.setEmulatedMedia',features=[{'name':'prefers-reduced-motion','value':'reduce' if reduced else 'no-preference'}])
    value=cast(dict[str,Any],js(f'window.walkthroughTests.{expression}.then(result=>({{result}})).catch(error=>({{error:error.message,stack:error.stack}}))'))
    assert value.get('result') and not value.get('error'),(name,value)
    record(name,value['result'])
cdp('Emulation.setEmulatedMedia',features=[{'name':'prefers-reduced-motion','value':'no-preference'}])

# Native keyboard: reveal action, branch navigation, actual modal and focus return.
mount()
focus_button('Explain workflow');key('Enter')
check('!window.nativeFixture.container.querySelector(".wf-walkthrough").hidden','Keyboard did not open tour')
check('''(()=>{const p=window.nativeFixture.container.querySelector('.wf-walkthrough'),b=window.walkthroughTests.button(p,'Next'),r=b.getBoundingClientRect(),v=p.getBoundingClientRect();return r.top>=v.top&&r.bottom<=v.bottom})()''','Playback navigation is not visible without scrolling the explanation')
focus_button('Next');key('Enter')
check('window.nativeFixture.container.querySelector(".wf-walkthrough h3").textContent.includes("Condition")','Native Next did not select condition')
focus_button('Open current block settings');key('Enter')
check('window.nativeFixture.container.querySelector("dialog").matches(":modal")','Keyboard tour action did not open native modal')
key('Tab')
check('window.nativeFixture.container.querySelector("dialog").contains(document.activeElement)','Modal focus escaped')
key('Escape')
check('document.activeElement.textContent==="Open current block settings"','Native Escape did not return tour focus')
focus_button('Close walkthrough');key('Enter')
check('document.activeElement.textContent==="Explain workflow"','Tour close did not return focus')
record('native-keyboard-modal',{'nativeEnter':True,'nativeTabTrap':True,'nativeEscape':True,'focusReturned':True})
dispose()

# Real pointer movement while the presentation clock is active, not synthetic events.
mount(True)
position=cast(dict[str,Any],js('''(()=>{const c=window.nativeFixture.container,n=c.querySelector('.wf-node'),h=n.querySelector('.wf-node-head').getBoundingClientRect();return {x:h.x+30,y:h.y+18,left:parseFloat(n.style.left),top:parseFloat(n.style.top),zoom:parseFloat(c.querySelector('.wf-stage').style.transform.slice(6))}})()'''))
for kind,dx,dy,buttons in [('mousePressed',0,0,1),('mouseMoved',40,25,1),('mouseReleased',40,25,0)]:
    cdp('Input.dispatchMouseEvent',type=kind,x=position['x']+dx,y=position['y']+dy,button='left',buttons=buttons,clickCount=1,_response_timeout=20)
settle()
after=cast(dict[str,Any],js('''(()=>{const c=window.nativeFixture.container,n=c.querySelector('.wf-node');return {left:parseFloat(n.style.left),top:parseFloat(n.style.top),replay:!!c.querySelector('.wf-creation-bar')}})()'''))
assert abs(after['left']-position['left']-40/position['zoom'])<.002,(position,after)
assert abs(after['top']-position['top']-25/position['zoom'])<.002,(position,after)
assert not after['replay'],after
focus_button('Undo');key('Enter')
check('window.walkthroughTests.button(window.nativeFixture.container,"Undo").disabled','Drag not one undo')
record('native-drag-during-replay',{'positionsExact':True,'replayCancelled':True,'oneUndo':True})
dispose()

for name,width,height in [('short-desktop-layout',1280,577),('mobile-layout',390,844)]:
    cdp('Emulation.setDeviceMetricsOverride',width=width,height=height,deviceScaleFactor=1,mobile=False)
    mount();focus_button('Explain workflow');key('Enter')
    metrics=cast(dict[str,Any],js('''(()=>{const e=window.nativeFixture.container.querySelector('.wf-editor'),v=e.querySelector('.wf-scroll'),p=e.querySelector('.wf-walkthrough');return {viewportWidth:innerWidth,documentWidth:document.documentElement.scrollWidth,canvasHeight:v.clientHeight,explanationHeight:p.querySelector('.wf-walkthrough-scroll').clientHeight,chromeHeight:v.getBoundingClientRect().top-e.getBoundingClientRect().top,panelWidth:p.getBoundingClientRect().width,editorWidth:e.getBoundingClientRect().width}})()'''))
    assert metrics['documentWidth']<=width and metrics['canvasHeight']>=300 and metrics['chromeHeight']<170,metrics
    assert metrics['panelWidth']<=metrics['editorWidth'] and metrics['explanationHeight']>=120,metrics
    import shutil
    shot=Path(f'/Users/te451223/.hermes/cache/scratch/workflow-walkthrough-{width}.png')
    shutil.copyfile(capture_screenshot(),shot)
    metrics['screenshot']=str(shot)
    record(name,metrics)
    print(str(shot))
    dispose()
cdp('Emulation.setDeviceMetricsOverride',width=1280,height=577,deviceScaleFactor=1,mobile=False)

# Actual tab backgrounding must dispatch document visibility changes and pause.
mount();focus_button('Explain workflow');key('Enter');focus_button('Play walkthrough');key('Enter')
js('window.visibilityTourTitle=window.nativeFixture.container.querySelector(".wf-walkthrough h3").textContent')
original=cdp('Target.getTargetInfo')['targetInfo']['targetId']
background=cdp('Target.createTarget',url='about:blank',background=False)['targetId']
cdp('Target.activateTarget',targetId=background)
settle()
was_hidden=js('document.hidden')
time.sleep(2.15)
cdp('Target.activateTarget',targetId=original);cdp('Page.bringToFront');settle()
check('window.nativeFixture.container.querySelector(".wf-walkthrough h3").textContent===window.visibilityTourTitle','Background tab advanced old explanation')
check('!!window.walkthroughTests.button(window.nativeFixture.container,"Play walkthrough")','Background tab did not pause')
assert was_hidden,'Chromium did not actually background the original tab'
record('actual-document-visibility',{'documentHiddenObserved':was_hidden,'timerPaused':True,'retainedStep':True})
cdp('Target.closeTarget',targetId=background)
dispose()
assert len(results)==18,results
print(json.dumps({'status':'PASS','browser_groups':len(results),'results':str(RESULTS)}))
