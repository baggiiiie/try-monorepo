export function getPreviewFrameHTML(cssString) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>${cssString}</style>
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
    @media print {
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

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'update-content') {
        paginateContent(e.data.html);
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
