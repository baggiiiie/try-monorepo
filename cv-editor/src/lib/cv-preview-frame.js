export function getPreviewFrameHTML(cssString) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>${cssString}</style>
</head>
<body>
  <div class="page" id="cv-root"></div>
  <script>
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'update-content') {
        document.getElementById('cv-root').innerHTML = e.data.html;
      }
    });
    window.parent.postMessage({ type: 'frame-ready' }, '*');
  </script>
</body>
</html>`;
}
