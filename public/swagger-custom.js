// Adds a visible OpenAPI JSON link under the API description text
(function () {
  function addOpenApiLink() {
    var info = document.querySelector('.swagger-ui .info');
    if (!info) return;

    if (document.getElementById('openapi-json-link-block')) return;

    var description = info.querySelector('.description') || info.querySelector('.markdown') || info;

    var block = document.createElement('div');
    block.id = 'openapi-json-link-block';
    block.style.marginTop = '8px';

    var link = document.createElement('a');
    link.href = '/openapi.json';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'OpenAPI JSON';
    link.style.fontWeight = '600';

    block.appendChild(link);

    if (description && description.parentNode) {
      description.parentNode.insertBefore(block, description.nextSibling);
    } else {
      info.appendChild(block);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    addOpenApiLink();
    var root = document.querySelector('.swagger-ui') || document.body;
    var obs = new MutationObserver(function () { addOpenApiLink(); });
    obs.observe(root, { childList: true, subtree: true });
  });
})();
