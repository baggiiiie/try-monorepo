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
    .section[draggable="true"] {
      cursor: grab;
    }
    .section[draggable="true"]:active {
      cursor: grabbing;
    }
    .section.drag-over-above {
      border-top: 2px solid rgba(59, 130, 246, 0.8);
    }
    .section.drag-over-below {
      border-bottom: 2px solid rgba(59, 130, 246, 0.8);
    }
    .section.dragging {
      opacity: 0.4;
    }
    li[data-yaml-path][draggable="true"] {
      cursor: grab;
    }
    li[data-yaml-path][draggable="true"]:active {
      cursor: grabbing;
    }
    li.drag-over-above {
      border-top: 2px solid rgba(59, 130, 246, 0.8);
      margin-top: -2px;
    }
    li.drag-over-below {
      border-bottom: 2px solid rgba(59, 130, 246, 0.8);
      margin-bottom: -2px;
    }
    li.dragging {
      opacity: 0.4;
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

    // Drag-and-reorder sections
    let dragSrcIdx = null;
    let dragType = null;

    function getSectionIndex(el) {
      const path = el.getAttribute('data-yaml-path');
      const m = path && path.match(/^sections\\[(\\d+)\\]$/);
      return m ? parseInt(m[1], 10) : null;
    }

    function parseBulletPath(el) {
      const path = el.getAttribute('data-yaml-path');
      if (!path) return null;
      const m = path.match(/^(.*\\.bullets)\\[(\\d+)\\]$/);
      if (!m) return null;
      return { bulletsPath: m[1], index: parseInt(m[2], 10) };
    }

    function setupDrag() {
      document.querySelectorAll('.section[data-yaml-path^="sections["]').forEach(el => {
        if (getSectionIndex(el) === null) return;
        el.setAttribute('draggable', 'true');

        el.addEventListener('dragstart', (e) => {
          dragSrcIdx = getSectionIndex(el);
          dragType = 'section';
          el.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });

        el.addEventListener('dragend', () => {
          el.classList.remove('dragging');
          document.querySelectorAll('.drag-over-above, .drag-over-below').forEach(
            x => { x.classList.remove('drag-over-above', 'drag-over-below'); }
          );
          dragSrcIdx = null;
          dragType = null;
        });

        el.addEventListener('dragover', (e) => {
          if (dragType !== 'section') return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const rect = el.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          el.classList.remove('drag-over-above', 'drag-over-below');
          if (e.clientY < midY) {
            el.classList.add('drag-over-above');
          } else {
            el.classList.add('drag-over-below');
          }
        });

        el.addEventListener('dragleave', () => {
          el.classList.remove('drag-over-above', 'drag-over-below');
        });

        el.addEventListener('drop', (e) => {
          if (dragType !== 'section') return;
          e.preventDefault();
          el.classList.remove('drag-over-above', 'drag-over-below');
          const targetIdx = getSectionIndex(el);
          if (dragSrcIdx === null || targetIdx === null || dragSrcIdx === targetIdx) return;
          const rect = el.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const insertBefore = e.clientY < midY;
          window.parent.postMessage({
            type: 'reorder-section',
            fromIndex: dragSrcIdx,
            toIndex: insertBefore ? targetIdx : targetIdx + 1,
          }, '*');
        });
      });

      // Drag-and-reorder bullet points
      let bulletDragSrc = null;

      document.querySelectorAll('li[data-yaml-path]').forEach(li => {
        const info = parseBulletPath(li);
        if (!info) return;
        li.setAttribute('draggable', 'true');

        li.addEventListener('dragstart', (e) => {
          e.stopPropagation();
          bulletDragSrc = info;
          dragType = 'bullet';
          li.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });

        li.addEventListener('dragend', () => {
          li.classList.remove('dragging');
          document.querySelectorAll('li.drag-over-above, li.drag-over-below').forEach(
            x => { x.classList.remove('drag-over-above', 'drag-over-below'); }
          );
          bulletDragSrc = null;
          dragType = null;
        });

        li.addEventListener('dragover', (e) => {
          if (dragType !== 'bullet') return;
          const targetInfo = parseBulletPath(li);
          if (!targetInfo || targetInfo.bulletsPath !== bulletDragSrc.bulletsPath) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          const rect = li.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          li.classList.remove('drag-over-above', 'drag-over-below');
          if (e.clientY < midY) {
            li.classList.add('drag-over-above');
          } else {
            li.classList.add('drag-over-below');
          }
        });

        li.addEventListener('dragleave', () => {
          li.classList.remove('drag-over-above', 'drag-over-below');
        });

        li.addEventListener('drop', (e) => {
          if (dragType !== 'bullet') return;
          e.preventDefault();
          e.stopPropagation();
          li.classList.remove('drag-over-above', 'drag-over-below');
          const targetInfo = parseBulletPath(li);
          if (!bulletDragSrc || !targetInfo) return;
          if (bulletDragSrc.bulletsPath !== targetInfo.bulletsPath) return;
          if (bulletDragSrc.index === targetInfo.index) return;
          const rect = li.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const insertBefore = e.clientY < midY;
          window.parent.postMessage({
            type: 'reorder-bullet',
            bulletsPath: bulletDragSrc.bulletsPath,
            fromIndex: bulletDragSrc.index,
            toIndex: insertBefore ? targetInfo.index : targetInfo.index + 1,
          }, '*');
        });
      });
    }

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'update-content') {
        lastHtml = e.data.html;
        paginateContent(lastHtml);
        setupDrag();
      }
      if (e.data?.type === 'update-styles') {
        document.getElementById('cv-styles').textContent = e.data.css;
        if (lastHtml) {
          paginateContent(lastHtml);
          setupDrag();
        }
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
