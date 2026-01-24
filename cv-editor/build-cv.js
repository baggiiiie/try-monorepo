const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const data = yaml.load(fs.readFileSync(path.join(__dirname, 'cv-data.yaml'), 'utf8'));
const template = fs.readFileSync(path.join(__dirname, 'cv-template.html'), 'utf8');

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderDetail(d) {
  if (typeof d === 'string') return `<div>${esc(d)}</div>`;
  if (d.italic) return `<div class="italic">${esc(d.italic)}</div>`;
  if (d.text) return `<div>${esc(d.text)}</div>`;
  if (d.coursework) return `<div><span class="underline">Relevant Coursework</span>: ${esc(d.coursework)}</div>`;
  return '';
}

function renderBullets(bullets) {
  if (!bullets || bullets.length === 0) return '';
  return '<ul>' + bullets.map(b => `<li>${esc(b)}</li>`).join('\n') + '</ul>';
}

function renderEntry(entry) {
  let html = '<div class="entry">\n';
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

function renderSection(title, entries) {
  let html = `\n  <div class="section-title">${esc(title)}</div>\n\n`;
  html += entries.map(renderEntry).join('\n\n');
  return html;
}

function renderSimpleList(title, items) {
  let html = `\n  <div class="section-title">${title}</div>\n`;
  html += '  <ul class="skills-list">\n';
  items.forEach(item => { html += `    <li>${item}</li>\n`; });
  html += '  </ul>';
  return html;
}

let content = '';

content += '  <div class="header">\n';
content += `    <h1>${esc(data.name)}</h1>\n`;
content += `    <div class="contact">${esc(data.contact.phone)} · ${esc(data.contact.email)} · <a href="${esc(data.contact.linkedin.url)}">${esc(data.contact.linkedin.label)}</a></div>\n`;
content += `    <div class="availability">${esc(data.availability)}</div>\n`;
content += '  </div>\n';

content += renderSection('Education', data.education);
content += renderSection('Professional Experience', data.experience);
content += renderSection('Other Significant Experience', data.other_experience);
content += renderSimpleList('Language &amp; Technical Skills', data.skills);
content += renderSimpleList('Distinction &amp; Interests', data.distinctions);

const output = template.replace('{{NAME}}', esc(data.name)).replace('{{CONTENT}}', content);

fs.writeFileSync(path.join(__dirname, 'cv.html'), output, 'utf8');
console.log('✓ cv.html generated successfully');
