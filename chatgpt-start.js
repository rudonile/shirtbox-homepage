(() => {
  'use strict';
  const button = document.getElementById('prompt-copy');
  const status = document.getElementById('chatgpt-status');
  const field = document.getElementById('chatgpt-prompt');
  const fallback = document.getElementById('chatgpt-copy-fallback');
  const prompt = JSON.parse(document.getElementById('chatgpt-prompt-data').textContent);
  field.value = prompt;

  function copyWithSelection() {
    fallback.hidden = false;
    field.focus();
    field.select();
    field.setSelectionRange(0, field.value.length);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { /* Manual selection stays available. */ }
    fallback.hidden = copied;
    if (copied) button.focus({preventScroll: true});
    return copied;
  }

  async function copyPrompt() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt);
        fallback.hidden = true;
        return true;
      }
    } catch { /* Use selection if clipboard access is blocked. */ }
    return copyWithSelection();
  }

  button.addEventListener('click', async () => {
    const copied = await copyPrompt();
    status.hidden = copied;
    status.textContent = copied
      ? ''
      : 'Automatisches Kopieren ist blockiert. Bitte kopieren Sie den markierten Prompt.';
  });
})();
