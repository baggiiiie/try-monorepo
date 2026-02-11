export function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderDetail(d, basePath, sanitize) {
  const s = sanitize || esc;
  if (typeof d === 'string') return `<div data-yaml-path="${basePath}" data-editable="html">${s(d)}</div>`;
  if (d.italic) return `<div class="italic" data-yaml-path="${basePath}.italic" data-editable="html">${s(d.italic)}</div>`;
  if (d.text) return `<div data-yaml-path="${basePath}.text" data-editable="html">${s(d.text)}</div>`;
  if (d.coursework) return `<div data-yaml-path="${basePath}.coursework" data-editable="html"><span class="underline">Relevant Coursework</span>: ${s(d.coursework)}</div>`;
  return '';
}

export function renderBullets(bullets, basePath, sanitize) {
  if (!bullets || bullets.length === 0) return '';
  const s = sanitize || esc;
  return '<ul>' + bullets.map((b, i) => `<li data-yaml-path="${basePath}[${i}]" data-editable="html">${s(b)}</li>`).join('\n') + '</ul>';
}

export function renderEntry(entry, path, sanitize) {
  const s = sanitize || esc;
  let html = `<div class="entry" data-yaml-path="${path}">\n`;
  html += '  <div class="entry-header">\n';
  html += `    <div class="entry-date" data-yaml-path="${path}.dates" data-editable="html">${s(entry.dates)}</div>\n`;
  html += `    <div class="entry-middle"><span class="institution" data-yaml-path="${path}.institution" data-editable="html">${s(entry.institution)}</span></div>\n`;
  html += `    <div class="entry-location" data-yaml-path="${path}.location" data-editable="html">${s(entry.location)}</div>\n`;
  html += '  </div>\n';
  html += '  <div class="entry-details">\n';
  if (entry.degree) html += `    <div class="degree" data-yaml-path="${path}.degree" data-editable="html">${s(entry.degree)}</div>\n`;
  if (entry.role) html += `    <div class="degree" data-yaml-path="${path}.role" data-editable="html">${s(entry.role)}</div>\n`;
  if (entry.details) entry.details.forEach((d, i) => { html += '    ' + renderDetail(d, `${path}.details[${i}]`, sanitize) + '\n'; });
  if (entry.bullets) html += '    ' + renderBullets(entry.bullets, `${path}.bullets`, sanitize) + '\n';
  html += '  </div>\n';
  html += '</div>';
  return html;
}

export function renderSection(title, entries, sectionPath, sanitize) {
  const s = sanitize || esc;
  let html = `\n  <div class="section" data-yaml-path="${sectionPath}">\n`;
  html += `  <div class="section-title" data-yaml-path="${sectionPath}.title" data-editable="html">${s(title)}</div>\n\n`;
  html += entries.map((entry, i) => renderEntry(entry, `${sectionPath}.entries[${i}]`, sanitize)).join('\n\n');
  html += '\n  </div>';
  return html;
}

export function renderSimpleList(title, items, sanitize, sectionPath) {
  const s = sanitize || esc;
  let html = `\n  <div class="section" data-yaml-path="${sectionPath}">\n`;
  html += `  <div class="section-title" data-yaml-path="${sectionPath}.title" data-editable="html">${s(title)}</div>\n`;
  html += '  <ul class="skills-list">\n';
  items.forEach((item, i) => {
    html += `    <li data-yaml-path="${sectionPath}.items[${i}]" data-editable="html">${s(item)}</li>\n`;
  });
  html += '  </ul>\n';
  html += '  </div>';
  return html;
}

export function renderHeader(data, sanitize) {
  const s = sanitize || esc;
  let html = '  <div class="header" data-yaml-path="header">\n';
  html += `    <h1 data-yaml-path="header.name" data-editable="html">${s(data.name)}</h1>\n`;
  html += `    <div class="contact"><span data-yaml-path="header.contact.phone" data-editable="html">${s(data.contact.phone)}</span> · <span data-yaml-path="header.contact.email" data-editable="html">${s(data.contact.email)}</span> · <a href="${esc(data.contact.linkedin.url)}"><span data-yaml-path="header.contact.linkedin.label" data-editable="html">${s(data.contact.linkedin.label)}</span></a></div>\n`;
  html += `    <div class="availability" data-yaml-path="header.availability" data-editable="html">${s(data.availability)}</div>\n`;
  html += '  </div>\n';
  return html;
}

export function renderCV(data, sanitize) {
  let content = '';
  content += renderHeader(data, sanitize);
  (data.sections || []).forEach((section, i) => {
    const sectionPath = `sections[${i}]`;
    if (section.entries) {
      content += renderSection(section.title, section.entries, sectionPath, sanitize);
    } else if (section.items) {
      content += renderSimpleList(section.title, section.items, sanitize, sectionPath);
    }
  });
  return content;
}
