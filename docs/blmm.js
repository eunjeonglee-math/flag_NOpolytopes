(function () {
  'use strict';
  const select = document.getElementById('blmm-weight');
  function renderWeight() {
    for (const block of document.querySelectorAll('.blmm-weight-block')) block.hidden = block.dataset.scale !== select.value;
    document.getElementById('blmm-weight-status').textContent = select.value === '1'
      ? 'Showing y = Ax + b at ρ' : 'Showing y = Ax + 2b at 2ρ (b denotes the translation at ρ)';
  }
  select.addEventListener('change', renderWeight);
  renderWeight();
})();
