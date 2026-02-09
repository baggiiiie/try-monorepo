export function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderDetail(d) {
  if (typeof d === 'string') return `<div>${esc(d)}</div>`;
  if (d.italic) return `<div class="italic">${esc(d.italic)}</div>`;
  if (d.text) return `<div>${esc(d.text)}</div>`;
  if (d.coursework) return `<div><span class="underline">Relevant Coursework</span>: ${esc(d.coursework)}</div>`;
  return '';
}

export function renderBullets(bullets) {
  if (!bullets || bullets.length === 0) return '';
  return '<ul>' + bullets.map(b => `<li>${esc(b)}</li>`).join('\n') + '</ul>';
}

export function renderEntry(entry, path) {
  let html = `<div class="entry" data-yaml-path="${path}">\n`;
  html += '  <div class="entry-header">\n';
  html += `    <div class="entry-date">${esc(entry.dates)}</div>\n`;
  html += `    <div class="entry-middle"><span class="institution">${esc(entry.institution)}</span></div>\n`;
  html += `    <div class="entry-location">${esc(entry.location)}</div>\n`;
  html += '  </div>\n';
  html += '  <div class="entry-details">\n';
  if (entry.degree) html += `    <div class="degree">${esc(entry.degree)}</div>\n`;
  if (entry.role) html += `    <div class="degree">${esc(entry.role)}</div>\n`;
  if (entry.details) entry.details.forEach(d => { html += '    ' + renderDetail(d) + '\n'; });
  if (entry.bullets) html += '    ' + renderBullets(entry.bullets) + '\n';
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
  items.forEach(item => {
    const content = sanitize ? sanitize(item) : item;
    html += `    <li>${content}</li>\n`;
  });
  html += '  </ul>\n';
  html += '  </div>';
  return html;
}

export function renderHeader(data) {
  let html = '  <div class="header" data-yaml-path="header">\n';
  html += `    <h1>${esc(data.name)}</h1>\n`;
  html += `    <div class="contact">${esc(data.contact.phone)} · ${esc(data.contact.email)} · <a href="${esc(data.contact.linkedin.url)}">${esc(data.contact.linkedin.label)}</a></div>\n`;
  html += `    <div class="availability">${esc(data.availability)}</div>\n`;
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
