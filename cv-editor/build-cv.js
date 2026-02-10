import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { renderCV, esc } from './src/lib/cv-renderer.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const data = yaml.load(fs.readFileSync(path.join(__dirname, 'cv-data.yaml'), 'utf8'));
const template = fs.readFileSync(path.join(__dirname, 'cv-template.html'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, 'src', 'lib', 'cv-styles.css'), 'utf8');

const content = renderCV(data);

const output = template.replace('{{STYLES}}', styles).replace('{{NAME}}', esc(data.name)).replace('{{CONTENT}}', content);

fs.writeFileSync(path.join(__dirname, 'cv.html'), output, 'utf8');
console.log('✓ cv.html generated successfully');
