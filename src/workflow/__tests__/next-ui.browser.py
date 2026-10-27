"""Isolated source-only Workflow IDE acceptance checks (existing Vite 5180).
Run via browser_exec: exec(Path('/Users/te451223/Flightdeck-code/src/workflow/__tests__/next-ui.browser.py').read_text())
No provider, resource, approval, Docker or host mutation. Local pure-data runs only.
"""
import json
import time
import shutil
from pathlib import Path
from browser_harness.helpers import goto_url, wait_for_load, cdp, js, capture_screenshot  # pyright: ignore[reportMissingImports]

ROOT=Path('/Users/te451223/Flightdeck-code/src/workflow')
ARTIFACTS=Path('/Users/te451223/.hermes/cache/scratch')
RESULTS=ARTIFACTS/'workflow-next-ui-browser-results.json'
results={}
def record(name,value):
    assert name not in results,name
    results[name]=value
    RESULTS.write_text(json.dumps(results,indent=2))
    print(json.dumps({'case':name,'status':'PASS','result':value}))
def run(expression):
    js('window.nextCaseResult=null;window.nextCaseError=null;void ('+expression+').then(value=>window.nextCaseResult=value).catch(error=>window.nextCaseError=error.message);"launched"')
    end=time.monotonic()+45
    while time.monotonic()<end:
        value=js('({result:window.nextCaseResult,error:window.nextCaseError})')
        assert isinstance(value,dict),value
        if value.get('error'):raise AssertionError(value)
        if value.get('result') is not None:return value['result']
        time.sleep(.1)
    raise TimeoutError(expression)
def screenshot(name):
    assert js('Boolean(document.querySelector(".wf-editor"))'),'Fixture disappeared before screenshot'
    path=ARTIFACTS/name
    shutil.copyfile(capture_screenshot(),path)
    print(str(path))
    return str(path)

goto_url('http://127.0.0.1:5180/src/workflow/__tests__/next-ui.html')
wait_for_load()
cdp('Page.bringToFront')
cdp('Emulation.setEmulatedMedia',features=[{'name':'prefers-reduced-motion','value':'no-preference'}])
for width,height in [(1280,577),(390,844)]:
    cdp('Emulation.setDeviceMetricsOverride',width=width,height=height,deviceScaleFactor=1,mobile=False)
    for theme in ['light','dark']:
        record(f'{width}-{theme}-layout',run(f'window.nextUiTests.premiumLayout({json.dumps(theme)})'))
record('active-only-first-fit',run('window.nextUiTests.inactiveFit()'))
record('review-local-definition',run('window.nextUiTests.wrapperReview()'))
cdp('Emulation.setDeviceMetricsOverride',width=1280,height=577,deviceScaleFactor=1,mobile=False)
js('import("/src/workflow/workflow-ide.browser.tsx").then(module=>window.ideTests=module)')
for name in ['proposalControlsBrowserTest','staleProposalBrowserTest','manifestSettingsBrowserTest','replacementGuardBrowserTest','hiddenInitialFitBrowserTest']:
    record(name,run(f'window.ideTests.{name}()'))
for filename,name,count in [('workflow-interactions.browser.js','native-data-transfer',5),('node-mapper-results.browser.js','actual-mapping-debugger',8)]:
    js('window.runnerFixture=window.nextUiTests.fixture({theme:"dark"});true')
    value=run((ROOT/filename).read_text())
    assert len(value)==count,value
    record(name,value)
    js('window.runnerFixture.dispose();true')

# Real screenshot states, with inherited tokens; no simulated model progress.
for width,height in [(1280,577),(390,844)]:
    cdp('Emulation.setDeviceMetricsOverride',width=width,height=height,deviceScaleFactor=1,mobile=False)
    for theme in ['light','dark']:
        js(f'window.visual=window.nextUiTests.fixture({{theme:{json.dumps(theme)}}});true')
        time.sleep(.15)
        shots=[screenshot(f'workflow-next-{width}-{theme}-canvas.png')]
        js('window.nextUiTests.button(window.visual.container,"Add or search blocks").click();true')
        time.sleep(.15)
        shots.append(screenshot(f'workflow-next-{width}-{theme}-composer.png'))
        js('window.nextUiTests.button(window.visual.container,"Custom block").click();true')
        time.sleep(.15)
        assert js('document.querySelector(".wf-wrapper-dialog").matches(":modal")')
        assert js('getComputedStyle(document.querySelector(".wf-checkbox input")).accentColor==="rgb(233, 131, 0)"')
        shots.append(screenshot(f'workflow-next-{width}-{theme}-review.png'))
        record(f'{width}-{theme}-actual-screens',{'screenshots':shots,'nativeReview':True,'hostAccentCheckbox':True})
        js('window.visual.dispose();true')
assert len(results)==17,results
print(json.dumps({'status':'PASS','browser_groups':len(results),'results':str(RESULTS)}))
