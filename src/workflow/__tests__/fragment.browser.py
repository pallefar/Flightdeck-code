"""Owned loopback source-only acceptance. Run through browser_exec, no HMR/API proxy."""
import json,time,base64
from pathlib import Path
from browser_harness.helpers import new_tab,goto_url,wait_for_load,cdp,js
ROOT=Path('/Users/te451223/Flightdeck-code')
OUT=ROOT/'docs/evidence/workflow-fragment'
OUT.mkdir(parents=True,exist_ok=True)
results={}
def record(name,value):
    assert name not in results,name
    results[name]=value
    (OUT/'browser-results.json').write_text(json.dumps(results,indent=2))
    print(json.dumps({'case':name,'result':value}))
def run(expr):
    js('window.fragmentResult=null;void ('+expr+').then(x=>window.fragmentResult={value:x}).catch(e=>window.fragmentResult={error:e.message});"launched"')
    end=time.monotonic()+40
    while time.monotonic()<end:
        value=js('window.fragmentResult')
        if value is not None:
            assert not value.get('error'),value
            return value['value']
        time.sleep(.1)
    raise TimeoutError(expr)
def key(name,shift=False):
    cdp('Input.dispatchKeyEvent',type='keyDown',key=name,code=name,modifiers=8 if shift else 0,windowsVirtualKeyCode=9 if name=='Tab' else 27)
    cdp('Input.dispatchKeyEvent',type='keyUp',key=name,code=name,modifiers=8 if shift else 0,windowsVirtualKeyCode=9 if name=='Tab' else 27)
def native_click(expression):
    js('('+expression+').scrollIntoView({block:"center",inline:"nearest"});true')
    time.sleep(.06)
    p=js('(()=>{const e='+expression+',r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,hit:e.contains(document.elementFromPoint(x,y))};})()')
    assert p['hit'],p
    cdp('Input.dispatchMouseEvent',type='mouseMoved',x=p['x'],y=p['y'])
    cdp('Input.dispatchMouseEvent',type='mousePressed',button='left',clickCount=1,x=p['x'],y=p['y'])
    cdp('Input.dispatchMouseEvent',type='mouseReleased',button='left',clickCount=1,x=p['x'],y=p['y'])
    time.sleep(.1)
def screenshot(name):
    image=cdp('Page.captureScreenshot',format='png',_response_timeout=45)
    path=OUT/name
    path.write_bytes(base64.b64decode(image['data']))
    return str(path.relative_to(ROOT))
new_tab('http://127.0.0.1:5297/src/workflow/__tests__/fragment.browser.html')
wait_for_load();time.sleep(.3);cdp('Page.bringToFront')
for name in ['atomic','pendingGuard','replacementCleanup','exactExportAndRun','approvalPause','mappedWrappers','invalidAndRevocation','visibilityCleanup','strictReview','narrationBoundary','nestedSettingsGuard','removedDraftCleanup']:
    value=run('window.fragmentTests.'+name+'()')
    if name=='exactExportAndRun':
        snapshots=js('window.fragmentSnapshots')
        assert isinstance(snapshots,dict),snapshots
        assert snapshots['before']==snapshots['undo'] and snapshots['after']==snapshots['redo']
        paths=[]
        for label,text in snapshots.items():
            path=OUT/f'export-{label}.json'
            path.write_text(text)
            paths.append(str(path.relative_to(ROOT)))
        value['snapshotFiles']=paths
    record(name,value)
# Existing unchanged browser regression paths loaded from the same owned origin.
record('existing-wrapper-review',run('window.nextUiTests.wrapperReview()'))
js('void import("/src/workflow/workflow-ide.browser.tsx").then(m=>window.ideTests=m);"loading"')
time.sleep(.3)
for name in ['manifestSettingsBrowserTest','replacementGuardBrowserTest']:
    record('existing-'+name,run('window.ideTests.'+name+'()'))
js('window.previous=window.nextUiTests.fixture();true');time.sleep(.2)
record('existing-block-settings-modal',run((ROOT/'src/workflow/block-settings-modal.browser.js').read_text()))
js('window.previous.dispose();true')
for width,height in [(1280,577),(390,844)]:
    cdp('Emulation.setDeviceMetricsOverride',width=width,height=height,deviceScaleFactor=1,mobile=False)
    for theme in ['light','dark']:
        for reduced in [False,True]:
            cdp('Emulation.setEmulatedMedia',features=[{'name':'prefers-reduced-motion','value':'reduce' if reduced else 'no-preference'}])
            js('window.visual=window.fragmentTests.setup(false,'+json.dumps(theme)+');true');time.sleep(.2)
            js('window.fragmentTests.button(window.visual.container,"Select and drag slot").click();true');time.sleep(.1)
            native_click('window.fragmentTests.button(window.visual.container,"Compose fragment")')
            state=js('(()=>{const d=document.querySelector(".wf-fragment-dialog"),r=d.getBoundingClientRect(),e=document.querySelector(".wf-editor"),t=d.querySelector("textarea");return {modal:d.matches(":modal"),focusInside:d.contains(document.activeElement),contained:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,hostInk:getComputedStyle(d).color===getComputedStyle(e).color,sourceHeight:t.clientHeight,documentOverflow:document.documentElement.scrollWidth>innerWidth};})()')
            assert state['modal'] and state['focusInside'] and state['contained'] and state['hostInk'] and not state['documentOverflow'],state
            assert state['sourceHeight']>=150,state
            for shift in [False,True]:
                for i in range(12):
                    key('Tab',shift)
                    assert js('document.querySelector(".wf-fragment-dialog").contains(document.activeElement)'),'Native Tab escaped modal'
            native_click('window.fragmentTests.button(document.querySelector(".wf-fragment-dialog"),"Inspect exact fragment")')
            assert js('!document.querySelector("#wf-fragment-reviewed").disabled'),'Valid example failed real inspection'
            shots=[screenshot(f'fragment-{width}-{theme}-reduced-{str(reduced).lower()}.png')]
            key('Escape');time.sleep(.15)
            assert js('!document.querySelector(".wf-fragment-dialog")&&document.activeElement===window.fragmentTests.button(window.visual.container,"Compose fragment")'),'Escape / focus return failed'
            record(f'native-{width}-{theme}-reduced-{str(reduced).lower()}',{**state,'nativeTabTrap':True,'nativeEscape':True,'focusReturned':True,'screenshots':shots})
            js('window.visual.dispose();true')
# A fully native reviewed Apply, with actual pointer hit tests.
cdp('Emulation.setDeviceMetricsOverride',width=1280,height=577,deviceScaleFactor=1,mobile=False)
js('window.visual=window.fragmentTests.setup(false,"dark");true');time.sleep(.2)
js('window.nativeBefore=JSON.stringify(window.visual.graph);window.fragmentTests.button(window.visual.container,"Select and drag slot").click();true');time.sleep(.1)
native_click('window.fragmentTests.button(window.visual.container,"Compose fragment")')
native_click('window.fragmentTests.button(document.querySelector(".wf-fragment-dialog"),"Inspect exact fragment")')
native_click('document.querySelector("#wf-fragment-reviewed")')
native_click('window.fragmentTests.button(document.querySelector(".wf-fragment-dialog"),"Apply reviewed fragment")')
assert js('!document.querySelector(".wf-fragment-dialog")&&!window.visual.graph.nodes.some(n=>n.id==="slot")'),'Native Apply failed'
js('window.nativeAfter=JSON.stringify(window.visual.graph);true')
native_click('window.fragmentTests.button(window.visual.container,"Undo")')
assert js('JSON.stringify(window.visual.graph)===window.nativeBefore'),'Native Undo mismatch'
native_click('window.fragmentTests.button(window.visual.container,"Redo")')
assert js('JSON.stringify(window.visual.graph)===window.nativeAfter'),'Native Redo mismatch'
record('native-apply-undo-redo',{'nativePointerHitTests':True,'exactUndoRedo':True,'screenshot':screenshot('fragment-native-applied.png')})
js('window.visual.dispose();true')
network=js('performance.getEntriesByType("resource").filter(e=>["fetch","xmlhttprequest"].includes(e.initiatorType)).map(e=>e.name)')
errors=js('window.fragmentBrowserErrors')
assert network==[],network
assert errors==[],errors
record('no-authority-network',{'fetchOrXhrRequests':len(network),'browserErrors':len(errors)})
assert len(results)==26,results.keys()
print(json.dumps({'status':'PASS','groups':len(results),'evidence':str(OUT/'browser-results.json')}))
