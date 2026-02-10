export function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderDetail(d, basePath) {
  if (typeof d === 'string') return `<div data-yaml-path="${basePath}" data-editable="true">${esc(d)}</div>`;
  if (d.italic) return `<div class="italic" data-yaml-path="${basePath}.italic" data-editable="true">${esc(d.italic)}</div>`;
  if (d.text) return `<div data-yaml-path="${basePath}.text" data-editable="true">${esc(d.text)}</div>`;
  if (d.coursework) return `<div data-yaml-path="${basePath}.coursework" data-editable="true"><span class="underline">Relevant Coursework</span>: ${esc(d.coursework)}</div>`;
  return '';
}

export function renderBullets(bullets, basePath) {
  if (!bullets || bullets.length === 0) return '';
  return '<ul>' + bullets.map((b, i) => `<li data-yaml-path="${basePath}[${i}]" data-editable="true">${esc(b)}</li>`).join('\n') + '</ul>';
}

export function renderEntry(entry, path) {
  let html = `<div class="entry" data-yaml-path="${path}">\n`;
  html += '  <div class="entry-header">\n';
  html += `    <div class="entry-date" data-yaml-path="${path}.dates" data-editable="true">${esc(entry.dates)}</div>\n`;
  html += `    <div class="entry-middle"><span class="institution" data-yaml-path="${path}.institution" data-editable="true">${esc(entry.institution)}</span></div>\n`;
  html += `    <div class="entry-location" data-yaml-path="${path}.location" data-editable="true">${esc(entry.location)}</div>\n`;
  html += '  </div>\n';
  html += '  <div class="entry-details">\n';
  if (entry.degree) html += `    <div class="degree" data-yaml-path="${path}.degree" data-editable="true">${esc(entry.degree)}</div>\n`;
  if (entry.role) html += `    <div class="degree" data-yaml-path="${path}.role" data-editable="true">${esc(entry.role)}</div>\n`;
  if (entry.details) entry.details.forEach((d, i) => { html += '    ' + renderDetail(d, `${path}.details[${i}]`) + '\n'; });
  if (entry.bullets) html += '    ' + renderBullets(entry.bullets, `${path}.bullets`) + '\n';
  html += '  </div>\n';
  html += '</div>';
  return html;
}

export function renderSection(title, entries, sectionKey) {
  let html = `\n  <div class="section-title" data-yaml-path="${sectionKey}">${esc(title)}</div>\n\n`;
  html += entries.map((entry, i) => renderEntry(entry, `${sectionKey}[${i}]`)).join('\n\n');
  return html;
}

export function renderSimpleList(title, items, sanitize, sectionKey) {
  let html = `\n  <div data-yaml-path="${sectionKey}">\n`;
  html += `  <div class="section-title">${esc(title)}</div>\n`;
  html += '  <ul class="skills-list">\n';
  items.forEach((item, i) => {
    const content = sanitize ? sanitize(item) : item;
    html += `    <li data-yaml-path="${sectionKey}[${i}]" data-editable="html">${content}</li>\n`;
  });
  html += '  </ul>\n';
  html += '  </div>';
  return html;
}

export function renderHeader(data) {
  let html = '  <div class="header" data-yaml-path="header">\n';
  html += `    <h1 data-yaml-path="header.name" data-editable="true">${esc(data.name)}</h1>\n`;
  html += `    <div class="contact"><span data-yaml-path="header.contact.phone" data-editable="true">${esc(data.contact.phone)}</span> · <span data-yaml-path="header.contact.email" data-editable="true">${esc(data.contact.email)}</span> · <a href="${esc(data.contact.linkedin.url)}"><span data-yaml-path="header.contact.linkedin.label" data-editable="true">${esc(data.contact.linkedin.label)}</span></a></div>\n`;
  html += `    <div class="availability" data-yaml-path="header.availability" data-editable="true">${esc(data.availability)}</div>\n`;
  html += '  </div>\n';
  return html;
}

export function renderCV(data, sanitize) {
  let content = '';
  content += renderHeader(data);
  content += renderSection('Education', data.education, 'education');
  content += renderSection('Professional Experience', data.experience, 'experience');
  content += renderSection('Other Significant Experience', data.other_experience, 'other_experience');
  content += renderSimpleList('Language & Technical Skills', data.skills, sanitize, 'skills');
  content += renderSimpleList('Distinction & Interests', data.distinctions, sanitize, 'distinctions');
  return content;
}
