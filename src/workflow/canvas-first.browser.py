"""Native Chromium/CDP regression. Execute with browser_exec helpers on /demo.
No installs; test edits remain in the isolated tab, with no server execution.
"""
import json
import time
from pathlib import Path
from typing import Any, cast
from browser_harness.helpers import goto_url, wait_for_load, cdp, js  # pyright: ignore[reportMissingImports]

ROOT = Path('/Users/te451223/Flightdeck-code/src/workflow')

def check(expression, message):
    assert js(expression), message

def pause():
    time.sleep(.12)

def mouse(selector, count=1):
    rect = cast(dict[str,Any], js(f'''(()=>{{const e=document.querySelector({json.dumps(selector)});if(!e)throw Error('Missing '+{json.dumps(selector)});e.scrollIntoView({{block:'nearest'}});const r=e.getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+r.height/2}};}})()'''))
    for click in range(count):
        cdp('Input.dispatchMouseEvent', type='mousePressed', **rect, button='left', buttons=1, clickCount=click+1,_response_timeout=20)
        cdp('Input.dispatchMouseEvent', type='mouseReleased', **rect, button='left', buttons=0, clickCount=click+1,_response_timeout=20)
    pause()

def key(value, code=None):
    cdp('Input.dispatchKeyEvent', type='keyDown', key=value, code=code or value, text='\r' if value=='Enter' else '', windowsVirtualKeyCode={'Tab':9,'Enter':13,'Escape':27,'ArrowDown':40}.get(value,0))
    cdp('Input.dispatchKeyEvent', type='keyUp', key=value, code=code or value)
    pause()

cdp('Emulation.setDeviceMetricsOverride', width=1280,height=577,deviceScaleFactor=1,mobile=False)
goto_url('http://127.0.0.1:5180/demo')
wait_for_load()
cdp('Page.bringToFront')
cdp('Emulation.setDeviceMetricsOverride', width=1280,height=577,deviceScaleFactor=1,mobile=False)
pause()
check('''(()=>{const r=document.querySelector('.wf-scroll').getBoundingClientRect();return r.top<innerHeight-200&&[...document.querySelectorAll('.wf-node')].some(n=>{const b=n.getBoundingClientRect();return b.top>=r.top&&b.bottom<innerHeight})})()''','Initial canvas graph is below the first fold')
check('!!document.querySelector("button[aria-controls=workflow-palette]")', 'Missing accessible palette toggle')
check('document.querySelector("button[aria-controls=workflow-palette]").getAttribute("aria-expanded")==="false"', 'Palette must start collapsed')
mouse('button[aria-controls=workflow-palette]')
check('document.querySelector("#workflow-palette").getBoundingClientRect().width>0','Palette failed to open')
mouse('[aria-label="Search blocks"]')
cdp('Input.insertText', text='condition')
pause()
mouse('button[aria-controls=workflow-palette]')
check('!document.querySelector("#workflow-palette").contains(document.activeElement)','Focus stranded in hidden palette')
mouse('button[aria-controls=workflow-palette]')
check('document.querySelector(`[aria-label="Search blocks"]`).value==="condition"','Palette search discarded')
mouse('button[aria-controls=workflow-palette]')
# Native click opens inspector, and the same form must survive collapse/modal.
mouse('.wf-node:nth-of-type(2) .wf-node-head')
check('document.querySelector("button[aria-controls=workflow-inspector]").getAttribute("aria-expanded")==="true"','Single click must reveal inspector')
check('''[...document.querySelectorAll('.wf-tabs [role=tab]')].every(t=>t.getBoundingClientRect().height<=38)''','Inspector tab labels wrap into oversized controls')
mouse('[aria-label="Condition field"]')
cdp('Input.insertText', text='-draft')
pause()
js('window.retainedCondition=document.querySelector(`[aria-label="Condition field"]`);window.retainedValue=window.retainedCondition.value')
mouse('button[aria-controls=workflow-inspector]')
check('!document.querySelector("#workflow-inspector").contains(document.activeElement)','Focus stranded in hidden inspector')
mouse('button[aria-controls=workflow-inspector]')
check('document.querySelector(`[aria-label="Condition field"]`)===window.retainedCondition && window.retainedCondition.value===window.retainedValue','Collapse remounted/discarded form')
mouse('button[aria-controls=workflow-inspector]')
mouse('.wf-node:nth-of-type(2) .wf-node-head',2)
check('document.querySelector("dialog").matches(":modal")','Native double click did not open modal')
check('document.querySelector(`[aria-label="Condition field"]`)===window.retainedCondition','Modal remounted form')
key('Tab')
check('document.querySelector("dialog").contains(document.activeElement)','Modal focus escaped')
key('Escape')
check('!document.querySelector("dialog").open','Escape did not close modal')
check('window.retainedCondition.value===window.retainedValue','Escape discarded draft')
# Toggle with native keyboard, not a scripted React event.
js('document.querySelector("button[aria-controls=workflow-palette]").focus()')
key('Enter')
check('document.querySelector("button[aria-controls=workflow-palette]").getAttribute("aria-expanded")==="true"','Enter did not toggle palette')
key('Enter')
print(json.dumps({'status':'PASS','test':'native panel toggles, retained search/settings/modal draft, focus and keyboard'}))
# Fresh document: initial fitting, explicit fitting after zoom/panel changes,
# and all target responsive sizes, with native pointer activation.
goto_url('http://127.0.0.1:5180/demo')
wait_for_load()
pause()
check('!!document.querySelector(`[aria-label="Fit to graph"]`)','Missing working Fit to graph')
for width,height in [(1440,900),(1280,577),(1024,768),(390,844)]:
    cdp('Emulation.setDeviceMetricsOverride', width=width,height=height,deviceScaleFactor=1,mobile=False)
    pause()
    mouse('[aria-label="Fit to graph"]')
    check('document.documentElement.scrollWidth<=window.innerWidth','Document horizontal overflow')
    check('document.querySelector(".wf-scroll").getBoundingClientRect().height>=300','Canvas too short')
    check('document.querySelector(".wf-scroll").getBoundingClientRect().top-document.querySelector(".wf-editor").getBoundingClientRect().top<170','Editor chrome crowds out canvas')
    check('''(()=>{const v=document.querySelector('.wf-scroll'),r=v.getBoundingClientRect();return [...document.querySelectorAll('.wf-node')].every(n=>{const b=n.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.left+v.clientWidth+1&&b.top>=r.top-1&&b.bottom<=r.top+v.clientHeight+1})})()''','Fit did not contain graph bounds')
    check('''[...document.querySelectorAll('.wf-editor button')].find(b=>b.textContent==='Undo').disabled''','Fit polluted history')
    print(json.dumps({'status':'PASS','test':'responsive fit','width':width,'height':height}))
cdp('Emulation.setDeviceMetricsOverride', width=1280,height=577,deviceScaleFactor=1,mobile=False)
pause()
mouse('button[aria-controls=workflow-palette]')
mouse('[aria-label="Zoom in"]')
mouse('[aria-label="Fit to graph"]')
# All view-only operations must leave geometry and history intact.
js('window.beforeViewPositions=[...document.querySelectorAll(".wf-node")].map(n=>({left:n.style.left,top:n.style.top}))')
check('''(()=>{const v=document.querySelector('.wf-scroll'),r=v.getBoundingClientRect();return [...document.querySelectorAll('.wf-node')].every(n=>{const b=n.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.left+v.clientWidth+1&&b.top>=r.top-1&&b.bottom<=r.top+v.clientHeight+1})})()''','Fit ignored panel width or current zoom')
print(json.dumps({'status':'PASS','test':'native fit after panel opening and zoom'}))
# A keyboard route to the same native modal is mandatory.
mouse('.wf-node:nth-of-type(2) .wf-node-head')
check('!!document.querySelector(`[aria-label="Open block settings"]`)','Missing keyboard-accessible modal action')
js('document.querySelector(`[aria-label="Open block settings"]`).focus()')
key('Enter')
check('document.querySelector("dialog").matches(":modal")','Keyboard did not open modal')
key('Escape')
check('document.activeElement===document.querySelector(`[aria-label="Open block settings"]`)','Modal keyboard opener focus was not restored')
print(json.dumps({'status':'PASS','test':'keyboard-open native modal'}))
# Guard destructive document replacement against actual graph edits.
mouse('[aria-label="Workflow name"]')
cdp('Input.insertText',text=' edited')
pause()
mouse('.wf-document-menu summary')
# Capture beforeunload-style browser dialog via CDP; click returns immediately.
js('window.confirmationSeen=null;window.savedConfirm=window.confirm;window.confirm=(message)=>{window.confirmationSeen=message;return false}')
mouse('.wf-document-menu button')
check('typeof window.confirmationSeen==="string"','Edited graph replaced without a confirmation')
check('document.querySelectorAll(".wf-node").length===4','Cancelled replacement still discarded graph')
js('window.confirm=window.savedConfirm')
print(json.dumps({'status':'PASS','test':'cancelled edited-graph replacement'}))
# Compact uses its own geometry; view-only changes do not move blocks.
js('(()=>{const s=document.querySelector(`[aria-label="Block display"]`);s.value="compact";s.dispatchEvent(new Event("change",{bubbles:true}))})()');pause()
check('document.querySelector(`[aria-label="Block display"]`).value==="compact"','Compact selection failed')
mouse('[aria-label="Fit to graph"]')
check('JSON.stringify([...document.querySelectorAll(".wf-node")].map(n=>({left:n.style.left,top:n.style.top})))===JSON.stringify(window.beforeViewPositions)','View changes moved graph nodes')
check('''(()=>{const v=document.querySelector('.wf-scroll'),r=v.getBoundingClientRect();return [...document.querySelectorAll('.wf-node')].every(n=>{const b=n.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.left+v.clientWidth+1&&b.top>=r.top-1&&b.bottom<=r.top+v.clientHeight+1})})()''','Compact fit did not contain graph')
print(json.dumps({'status':'PASS','test':'native Compact fit and unchanged positions'}))
# Real import of a maximum-size, distant graph; one undo restores the document.
goto_url('http://127.0.0.1:5180/demo');wait_for_load();pause()
mouse('.wf-document-menu summary')
mouse('.wf-document-menu button:last-child')
check('document.activeElement===document.querySelector(`[aria-label="Draft JSON"]`)','JSON transfer did not receive keyboard focus')
check('!document.querySelector(".wf-document-menu").open','Document disclosure obscures canvas after action')
graph=cast(dict[str,Any],js('JSON.parse(document.querySelector(`[aria-label="Draft JSON"]`).value)'))
graph['nodes']=[dict(id=f'fit{i}',type='manual',label=f'Fit block {i}',position=dict(x=i*100,y=i*100),config={}) for i in range(100)]
graph['edges']=[]
mouse('[aria-label="Draft JSON"]')
js('document.querySelector(`[aria-label="Draft JSON"]`).select()')
cdp('Input.insertText',text=json.dumps(graph));pause()
js('window.importConfirm=window.confirm;window.confirm=()=>true')
mouse('.wf-panel button')
js('window.confirm=window.importConfirm')
mouse('[aria-label="Fit to graph"]')
check('document.querySelectorAll(".wf-node").length===100','Large graph import failed')
check('''(()=>{const v=document.querySelector('.wf-scroll'),r=v.getBoundingClientRect();return [...document.querySelectorAll('.wf-node')].every(n=>{const b=n.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.left+v.clientWidth+1&&b.top>=r.top-1&&b.bottom<=r.top+v.clientHeight+1})})()''','Large graph fit failed')
js('window.beforeFitGraph=[...document.querySelectorAll(".wf-node")].map(n=>n.style.cssText);document.querySelector(`[aria-label="Fit to graph"]`).click()');pause()
check('JSON.stringify(window.beforeFitGraph)===JSON.stringify([...document.querySelectorAll(".wf-node")].map(n=>n.style.cssText))','Large graph fit moved positions')
js('[...document.querySelectorAll(".wf-editor button")].find(b=>b.textContent==="Undo").click()');pause()
check('document.querySelectorAll(".wf-node").length===4','Fit added an undo entry')
print(json.dumps({'status':'PASS','test':'100-block distant graph real import, fit, unchanged positions, one undo'}))
