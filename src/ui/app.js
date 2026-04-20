// openbridge UI logic
// Full implementation to be built with Cursor

document.getElementById('btn-select-file').addEventListener('click', async () => {
  const filePath = await window.bridge.openFile();
  if (filePath) {
    document.getElementById('selected-file').textContent = `Ausgewählt: ${filePath}`;
    document.getElementById('step-mapping').classList.remove('hidden');
  }
});

// TODO: column mapping, dry-run, import
