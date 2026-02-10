export function getPreviewFrameHTML(cssString) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style id="cv-styles">${cssString}</style>
  <style>
    body {
      background: #e5e7eb;
      padding: 20px 0;
    }
    .page {
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      margin: 0 auto 20px auto;
      overflow: hidden;
    }
    .page:last-child {
      margin-bottom: 0;
    }
    #cv-measure {
      position: absolute;
      visibility: hidden;
      width: 210mm;
      padding: 10mm 13mm;
      top: 0;
      left: -9999px;
    }
    [data-yaml-path] {
      transition: background 0.15s;
    }
    [data-yaml-path].hover-highlight {
      background: rgba(255, 213, 79, 0.25);
      border-radius: 2px;
    }
    [data-editable] {
      cursor: pointer;
      border-radius: 2px;
      transition: outline 0.15s, background 0.15s;
    }
    [data-editable]:hover {
      outline: 1.5px dashed rgba(59, 130, 246, 0.5);
      outline-offset: 2px;
    }
    [data-editable].editing {
      outline: 2px solid rgba(59, 130, 246, 0.8);
      outline-offset: 2px;
      background: rgba(59, 130, 246, 0.05);
      cursor: text;
    }
    @media print {
      [data-yaml-path].hover-highlight {
        background: none;
      }
      [data-editable] {
        outline: none !important;
        cursor: default;
      }
      body {
        background: #fff;
        padding: 0;
      }
      .page {
        box-shadow: none;
        margin: 0;
        page-break-after: always;
      }
      .page:last-child {
        page-break-after: auto;
      }
      #cv-measure {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div id="cv-pages"></div>
  <div id="cv-measure"></div>
  <script>
    const PAGE_HEIGHT_PX = 297 * (96 / 25.4); // 297mm in px
    const PAGE_PADDING_PX = 10 * (96 / 25.4) * 2; // 10mm top + 10mm bottom
    const USABLE_HEIGHT = PAGE_HEIGHT_PX - PAGE_PADDING_PX;

    function paginateContent(html) {
      const measure = document.getElementById('cv-measure');
      const pagesContainer = document.getElementById('cv-pages');
      measure.innerHTML = html;

      const children = Array.from(measure.children);
      if (children.length === 0) {
        pagesContainer.innerHTML = '<div class="page"></div>';
        return;
      }

      const pages = [];
      let currentPageChildren = [];
      let currentHeight = 0;

      for (const child of children) {
        const rect = child.getBoundingClientRect();
        const style = window.getComputedStyle(child);
        const marginTop = parseFloat(style.marginTop) || 0;
        const marginBottom = parseFloat(style.marginBottom) || 0;
        const totalHeight = rect.height + marginTop + marginBottom;

        if (currentHeight + totalHeight > USABLE_HEIGHT && currentPageChildren.length > 0) {
          pages.push(currentPageChildren);
          currentPageChildren = [];
          currentHeight = 0;
        }
        currentPageChildren.push(child.outerHTML);
        currentHeight += totalHeight;
      }
      if (currentPageChildren.length > 0) {
        pages.push(currentPageChildren);
      }

      pagesContainer.innerHTML = pages
        .map(pageChildren => '<div class="page">' + pageChildren.join('') + '</div>')
        .join('');

      measure.innerHTML = '';
    }

    let lastHtml = '';
    let lastHoverEl = null;
    let lastHoverPath = null;
    let activeEditEl = null;
    let originalText = '';

    function startEditing(el) {
      if (activeEditEl) finishEditing(activeEditEl);
      activeEditEl = el;
      const isHtml = el.getAttribute('data-editable') === 'html';
      originalText = isHtml ? el.innerHTML : el.textContent;
      el.contentEditable = 'true';
      el.classList.add('editing');
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    function finishEditing(el) {
      if (!el) return;
      el.contentEditable = 'false';
      el.classList.remove('editing');
      const isHtml = el.getAttribute('data-editable') === 'html';
      const newText = isHtml ? el.innerHTML : el.textContent;
      if (newText !== originalText) {
        const path = el.getAttribute('data-yaml-path');
        window.parent.postMessage({
          type: 'inline-edit',
          path: path,
          value: newText,
          isHtml: isHtml,
        }, '*');
      }
      activeEditEl = null;
      originalText = '';
    }

    function cancelEditing(el) {
      if (!el) return;
      const isHtml = el.getAttribute('data-editable') === 'html';
      if (isHtml) el.innerHTML = originalText;
      else el.textContent = originalText;
      el.contentEditable = 'false';
      el.classList.remove('editing');
      activeEditEl = null;
      originalText = '';
    }

    document.addEventListener('click', (e) => {
      const editable = e.target.closest('[data-editable]');
      if (editable) {
        e.preventDefault();
        e.stopPropagation();
        if (editable !== activeEditEl) {
          startEditing(editable);
        }
      } else if (activeEditEl) {
        finishEditing(activeEditEl);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (!activeEditEl) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finishEditing(activeEditEl);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEditing(activeEditEl);
      }
    });

    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-yaml-path]');
      const path = el ? el.getAttribute('data-yaml-path') : null;
      if (path !== lastHoverPath) {
        if (lastHoverEl) lastHoverEl.classList.remove('hover-highlight');
        lastHoverPath = path;
        lastHoverEl = el;
        if (el) el.classList.add('hover-highlight');
        window.parent.postMessage({ type: 'hover-path', path }, '*');
      }
    });
    document.addEventListener('mouseleave', () => {
      if (lastHoverEl) lastHoverEl.classList.remove('hover-highlight');
      lastHoverEl = null;
      if (lastHoverPath !== null) {
        lastHoverPath = null;
        window.parent.postMessage({ type: 'hover-path', path: null }, '*');
      }
    });

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'update-content') {
        lastHtml = e.data.html;
        paginateContent(lastHtml);
      }
      if (e.data?.type === 'update-styles') {
        document.getElementById('cv-styles').textContent = e.data.css;
        if (lastHtml) paginateContent(lastHtml);
      }
      if (e.data?.type === 'highlight-path') {
        var prev = document.querySelector('[data-yaml-path].hover-highlight');
        if (prev) prev.classList.remove('hover-highlight');
        if (e.data.path) {
          var target = document.querySelector('[data-yaml-path="' + e.data.path + '"]');
          if (target) {
            target.classList.add('hover-highlight');
            target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }
      if (e.data?.type === 'print') {
        window.print();
      }
    });
    window.parent.postMessage({ type: 'frame-ready' }, '*');
  </script>
</body>
</html>`;
}
