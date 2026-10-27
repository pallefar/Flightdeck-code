// Run in the real /demo browser after loading a branch template.
(async () => {
  const node = [...document.querySelectorAll('.wf-node')].find(n => n.textContent.includes('Route request'));
  if (!node) throw new Error('Condition template block missing');
  node.querySelector('.wf-node-meta').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
  await new Promise(resolve => setTimeout(resolve, 50));
  const inspector = document.querySelector('[aria-label="Node inspector"]');
  if (!inspector.querySelector('[aria-label="Condition field"]')) throw new Error('Double-click did not open condition settings');
  const modal = inspector.closest('dialog');
  if (!modal?.matches(':modal') || !modal.contains(document.activeElement)) throw new Error('Double-click did not focus modal settings');
  const rect = modal.getBoundingClientRect();
  if (rect.bottom <= 0 || rect.top >= innerHeight) throw new Error('Settings not in view');
  return {doubleClickSettings: 'PASS', field: inspector.querySelector('[aria-label="Condition field"]').value, focused: true};
})()
