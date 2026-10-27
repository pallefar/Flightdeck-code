"""Real CSS/CDP DEVELOPMENT verification; no model/tool progress simulation.
Run with browser_exec, named session workflow-modular; existing source Vite 5180.
"""
import json
import time
import shutil
from pathlib import Path
from typing import Any, cast
from browser_harness.helpers import goto_url, wait_for_load, cdp, js, capture_screenshot  # pyright: ignore[reportMissingImports]
RESULTS=Path('/Users/te451223/.hermes/cache/scratch/workflow-modular-browser-results.json')
results={}
def js_object(expression):
    value=js(expression)
    assert isinstance(value,dict),value
    return cast(dict[str,Any],value)
def record(name,value):
    assert name not in results,name
    results[name]=value
    RESULTS.write_text(json.dumps(results,indent=2))
    print(json.dumps({'group':name,'status':'PASS','result':value}))
def check(expression,message):
    assert js(expression),message

goto_url('http://127.0.0.1:5180/src/workflow/__tests__/walkthrough.html')
wait_for_load()
cdp('Page.bringToFront')
cdp('Emulation.setDeviceMetricsOverride',width=1280,height=577,deviceScaleFactor=1,mobile=False)
js('import("/src/workflow/__tests__/modular-assembly.browser.tsx").then(()=>true)')
cases=[('physical-phases','modularPhases()',False),('compact-physical-phases','modularPhases("compact")',False),('connection-lock','connectionLock()',False),('ancestor-motion-off','ancestorMotionOff()',False),('local-motion-off','motionDisabled("local")',False),('system-reduced-motion','motionDisabled("reduced")',True),('real-export-no-effects','graphExportNoEffects()',False),('100-module-bound','maximumSnapBound()',False)]
for name,expression,reduced in cases:
    cdp('Emulation.setEmulatedMedia',features=[{'name':'prefers-reduced-motion','value':'reduce' if reduced else 'no-preference'}])
    value=js_object(f'window.modularTests.{expression}.then(result=>({{result}})).catch(error=>({{error:error.message,stack:error.stack}}))')
    assert value.get('result') and not value.get('error'),(name,value)
    record(name,value['result'])
cdp('Emulation.setEmulatedMedia',features=[{'name':'prefers-reduced-motion','value':'no-preference'}])
cdp('Emulation.setDeviceMetricsOverride',width=390,height=844,deviceScaleFactor=1,mobile=False)
value=js_object('window.modularTests.modularPhases().then(result=>({result})).catch(error=>({error:error.message}))')
assert value.get('result') and not value.get('error'),value
record('mobile-physical-phases',value['result'])
cdp('Emulation.setDeviceMetricsOverride',width=1280,height=577,deviceScaleFactor=1,mobile=False)

# The queued actual branch remains editable using physical CDP pointer input.
js('window.nativeFixture=window.walkthroughTests.fixture({reveal:true});window.walkthroughTests.button(window.nativeFixture.container,"Pause creation").click();true')
time.sleep(.1)
position=js_object('''(()=>{const c=window.nativeFixture.container,n=c.querySelector('.wf-node[data-creation-queued="true"]'),h=n.querySelector('.wf-node-head'),r=h.getBoundingClientRect();return {x:r.x+30,y:r.y+18,left:parseFloat(n.style.left),top:parseFloat(n.style.top),zoom:parseFloat(c.querySelector('.wf-stage').style.transform.slice(6)),name:h.getAttribute('aria-label'),hit:h.contains(document.elementFromPoint(r.x+30,r.y+18)),replay:!!c.querySelector('.wf-creation-bar')}})()''')
assert position['hit'] and position['replay'],position
for kind,dx,dy,buttons in [('mousePressed',0,0,1),('mouseMoved',42,26,1),('mouseReleased',42,26,0)]:
    cdp('Input.dispatchMouseEvent',type=kind,x=position['x']+dx,y=position['y']+dy,button='left',buttons=buttons,clickCount=1,_response_timeout=20)
time.sleep(.1)
after=js_object('''(()=>{const c=window.nativeFixture.container,n=c.querySelector('.wf-node.is-selected');return {left:parseFloat(n.style.left),top:parseFloat(n.style.top),replay:!!c.querySelector('.wf-creation-bar'),undo:!window.walkthroughTests.button(c,'Undo').disabled}})()''')
assert abs(after['left']-position['left']-42/position['zoom'])<.002,(position,after)
assert abs(after['top']-position['top']-26/position['zoom'])<.002,(position,after)
assert not after['replay'] and after['undo'],after
js('window.walkthroughTests.button(window.nativeFixture.container,"Undo").click()')
time.sleep(.1)
check('window.walkthroughTests.button(window.nativeFixture.container,"Undo").disabled&&!window.nativeFixture.container.querySelector(".wf-creation-bar")','Real queued-node drag was not one undo or replayed on undo')
record('native-queued-node-drag',{'queuedHeadHit':True,'exactDrag':True,'presentationInterrupted':True,'oneUndo':True,'noUndoReplay':True})
js('window.nativeFixture.dispose()')

# Explicit replay replaces only the decorative first plate, retaining real controls.
js('window.nativeFixture=window.walkthroughTests.fixture();true')
time.sleep(.1)
js('window.walkthroughTests.button(window.nativeFixture.container,"Explain workflow").click()')
time.sleep(.1)
js('window.walkthroughTests.button(window.nativeFixture.container,"Replay creation").click()')
time.sleep(.05)
js('window.walkthroughTests.button(window.nativeFixture.container,"Pause creation").click()')
time.sleep(.1)
js('window.firstPlate=window.nativeFixture.container.querySelector(".wf-assembly-plate");window.firstHead=window.nativeFixture.container.querySelector(".wf-node-head");window.walkthroughTests.button(window.nativeFixture.container,"Replay creation").click()')
time.sleep(.05)
js('window.walkthroughTests.button(window.nativeFixture.container,"Pause creation").click()')
time.sleep(.1)
check('window.nativeFixture.container.querySelector(".wf-assembly-plate")!==window.firstPlate&&window.nativeFixture.container.querySelector(".wf-node-head")===window.firstHead','Same-first-group replay failed to restart decoration or remounted editing controls')
record('same-first-group-replay',{'plateRestarted':True,'headIdentityRetained':True})
js('window.nativeFixture.dispose()')

# Scrub actual paused CSS animation for screenshots, not fabricated runtime progress.
for width,height in [(1280,577),(390,844)]:
    cdp('Emulation.setDeviceMetricsOverride',width=width,height=height,deviceScaleFactor=1,mobile=False)
    js('window.nativeFixture=window.walkthroughTests.fixture({reveal:true});window.walkthroughTests.button(window.nativeFixture.container,"Pause creation").click();true')
    time.sleep(.1)
    shots=[]
    for phase,fraction in [('placement-arrival',0),('snap-seat',.68)]:
        state=js_object(f'''(()=>{{const c=window.nativeFixture.container,p=c.querySelector('.wf-assembly-plate[data-assembly-phase="arriving"]'),a=p.getAnimations()[0];a.currentTime=Number(a.effect.getTiming().duration)*{fraction};return {{phase:p.dataset.assemblyPhase,transform:getComputedStyle(p).transform,headTransform:getComputedStyle(c.querySelector('.wf-node-head')).transform,buttonCenters:window.modularTests.hitTests(c),width:innerWidth,documentWidth:document.documentElement.scrollWidth}}}})()''')
        assert state['headTransform']=='none' and state['documentWidth']<=width,state
        path=Path(f'/Users/te451223/.hermes/cache/scratch/workflow-modular-{width}-{phase}.png')
        shutil.copyfile(capture_screenshot(),path)
        shots.append({'stage':phase,'screenshot':str(path),'state':state})
        print(str(path))
    js('window.walkthroughTests.button(window.nativeFixture.container.querySelector(".wf-creation-bar"),"Skip to final").click()')
    time.sleep(.1)
    check('[...window.nativeFixture.container.querySelectorAll(".wf-assembly-plate")].every(p=>p.dataset.assemblyPhase==="locked"&&getComputedStyle(p).transform==="none")','Screenshot final graph was not assembled')
    path=Path(f'/Users/te451223/.hermes/cache/scratch/workflow-modular-{width}-complete.png')
    shutil.copyfile(capture_screenshot(),path);print(str(path))
    shots.append({'stage':'complete-received-view','screenshot':str(path)})
    record(f'{width}-actual-css-stages',{'presentationOnly':True,'pausedCssScrub':True,'stages':shots})
    js('window.nativeFixture.dispose()')
cdp('Emulation.setDeviceMetricsOverride',width=1280,height=577,deviceScaleFactor=1,mobile=False)
assert len(results)==len(cases)+5,results
print(json.dumps({'status':'PASS','browser_groups':len(results),'results':str(RESULTS)}))
