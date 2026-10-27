"""Run via browser_exec with its pre-imported browser helpers.

exec(Path('/Users/te451223/Flightdeck-code/src/workflow/workflow-browser-checks.py').read_text())
Uses the existing local Vite instance; does not install browser dependencies.
"""
import json
import time
from pathlib import Path
from browser_harness.helpers import (  # pyright: ignore[reportMissingImports]
    goto_url, wait_for_load, cdp, js, capture_screenshot,
)

from typing import Any, cast


def js_object(expression: str) -> dict[str, Any]:
    value = js(expression)
    assert isinstance(value, dict), value
    return cast(dict[str, Any], value)


ROOT = Path('/Users/te451223/Flightdeck-code/src/workflow')
goto_url('http://127.0.0.1:5180/demo')
wait_for_load()
cdp('Page.bringToFront')
cdp('Emulation.setDeviceMetricsOverride', width=1280, height=577, deviceScaleFactor=1, mobile=False)


def run_assertions(filename, results_key, error_key, count):
    expression = (ROOT / filename).read_text()
    js(f'window.{error_key}=null;void (' + expression + f').catch(e=>{{window.{error_key}=e.message}}); "launched"')
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        result = js_object(f'({{results:window.{results_key},error:window.{error_key}}})')
        if result.get('error'):
            raise AssertionError(result)
        if len(result.get('results', [])) == count:
            print(json.dumps(result['results']))
            return result['results']
        time.sleep(.15)
    raise TimeoutError(f'{filename}: {result}')


palette = run_assertions('workflow-interactions.browser.js', 'workflowBrowserResults', 'workflowBrowserError', 5)
js("(()=>{const s=document.querySelector('[aria-label=\"Block display\"]');s.value='compact';s.dispatchEvent(new Event('change',{bubbles:true}));})()")
time.sleep(.1)
before = js_object("(()=>{const n=Array.from(document.querySelectorAll('.wf-node')).at(-1);const b=n.querySelector('.wf-node-head').getBoundingClientRect();return {x:b.x+40,y:b.y+15,left:parseFloat(n.style.left),top:parseFloat(n.style.top),zoom:parseFloat(document.querySelector('.wf-stage').style.transform.slice(6))};})()")
for kind, dx, dy, buttons in [('mousePressed', 0, 0, 1), ('mouseMoved', 80, 40, 1), ('mouseReleased', 80, 40, 0)]:
    cdp('Input.dispatchMouseEvent', type=kind, x=before['x']+dx, y=before['y']+dy, button='left', buttons=buttons, clickCount=1, _response_timeout=20)
time.sleep(.1)
after = js_object("(()=>{const n=Array.from(document.querySelectorAll('.wf-node')).at(-1);return {left:parseFloat(n.style.left),top:parseFloat(n.style.top),selected:n.classList.contains('is-selected'),width:n.style.width,height:n.style.height};})()")
assert abs(after['left']-(before['left']+80/before['zoom'])) < .002, (before, after)
assert abs(after['top']-(before['top']+40/before['zoom'])) < .002, (before, after)
assert after['selected'] and after['width'] == '176px' and after['height'] == '88px', after
print(json.dumps({'test':'real mouse Compact node reposition','before':before,'after':after,'status':'PASS'}))
regressions = run_assertions('workflow-regressions.browser.js', 'workflowRegressionResults', 'workflowRegressionError', 2)
print(json.dumps({'status':'PASS','browser_groups':len(palette)+1+len(regressions)}))
print(capture_screenshot())
