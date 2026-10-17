// Execute in a real browser on /demo with the branch template.
(async () => {
  const node = [...document.querySelectorAll('.wf-node')].find(n => n.textContent.includes('Route request'));
  if (!node) throw new Error('Condition template block missing');
  node.querySelector('.wf-node-meta').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));
  await new Promise(r => setTimeout(r,50));
  const modal = document.querySelector('dialog[aria-label="Block settings"]');
  if (!modal?.open || !modal.matches(':modal')) throw new Error('Double-click did not open a modal settings dialog');
  const field = modal.querySelector('[aria-label="Condition field"]');
  if (!field || !modal.contains(document.activeElement)) throw new Error('Modal lacks condition controls or focus');
  const original=field.value;
  const change = value => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value); field.dispatchEvent(new Event('input',{bubbles:true})); };
  change('modal-route');
  await new Promise(r => setTimeout(r,30));
  modal.querySelector('[aria-label="Close block settings"]').click();
  await new Promise(r => setTimeout(r,30));
  if (modal.open) throw new Error('Close did not dismiss modal');
  node.querySelector('.wf-node-meta').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));
  await new Promise(r => setTimeout(r,30));
  if (modal.querySelector('[aria-label="Condition field"]').value !== 'modal-route') throw new Error('Closing discarded unsaved settings');
  change(original);
  await new Promise(r => setTimeout(r,30));
  [...modal.querySelectorAll('button')].find(b=>b.textContent==='Apply settings').click();
  await new Promise(r => setTimeout(r,30));
  if (!modal.innerText.includes('Saved settings')) throw new Error('Apply did not save');
  return {modal:'PASS',focus:'PASS',close:'PASS',unsavedDraftRetained:'PASS',apply:'PASS'};
})()
