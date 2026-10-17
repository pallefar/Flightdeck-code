"""Run through browser_exec on the existing Vite source server (5180).
Explicit DEVELOPMENT callback fixture only; never invokes a vendor or workflow.
exec(Path('/Users/te451223/Flightdeck-code/src/workflow/workflow-ide.browser.py').read_text())
"""
import json
import time
from pathlib import Path
from typing import Any, cast
from browser_harness.helpers import goto_url, wait_for_load, cdp, js  # pyright: ignore[reportMissingImports]

RESULTS = Path('/Users/te451223/.hermes/cache/scratch/workflow-ide-results.json')
results = {}
goto_url('http://127.0.0.1:5180/demo')
wait_for_load()
cdp('Page.bringToFront')
cdp('Emulation.setDeviceMetricsOverride', width=1280, height=577, deviceScaleFactor=1, mobile=False)

for name, function, reduced in [
    ('handoff', 'replacementGuardBrowserTest', False),
    ('proposal', 'proposalControlsBrowserTest', False),
    ('staleProposal', 'staleProposalBrowserTest', False),
    ('firstVisibleFit', 'hiddenInitialFitBrowserTest', False),
    ('manifestSettings', 'manifestSettingsBrowserTest', False),
    ('topologyReveal', 'topologyRevealBrowserTest', False),
    ('reducedMotion', 'topologyRevealBrowserTest', True),
]:
    cdp('Emulation.setEmulatedMedia', features=[{'name':'prefers-reduced-motion','value':'reduce' if reduced else 'no-preference'}])
    js(f"window.ideCaseResult=null;window.ideCaseError=null;void import('/src/workflow/workflow-ide.browser.tsx').then(m=>m.{function}({str(reduced).lower() if function=='topologyRevealBrowserTest' else ''})).then(result=>window.ideCaseResult=result).catch(error=>window.ideCaseError=error.message);'launched'")
    deadline = time.monotonic() + 30
    value: dict[str, Any] = {}
    while time.monotonic() < deadline:
        raw = js('({result:window.ideCaseResult,error:window.ideCaseError})')
        assert isinstance(raw, dict), raw
        value = cast(dict[str, Any], raw)
        if value and (value.get('result') or value.get('error')):
            break
        time.sleep(.1)
    assert value and value.get('result') and not value.get('error'), (name, value)
    results[name] = value['result']
    RESULTS.write_text(json.dumps(results, indent=2))
    print(json.dumps({'test':name,'status':'PASS','result':value['result']}))

assert len(results) == 7, results
assert results['topologyReveal']['branchStatusColor'] == results['reducedMotion']['branchStatusColor'], results
cdp('Emulation.setEmulatedMedia', features=[{'name':'prefers-reduced-motion','value':'no-preference'}])
print(json.dumps({'status':'PASS','new_browser_groups':len(results),'results':str(RESULTS)}))
