export function findYamlLineRange(yamlString, path) {
  if (!path) return null
  const lines = yamlString.split('\n')

  if (path === 'header') {
    const headerKeys = ['name', 'contact', 'availability']
    let startLine = null
    let endLine = null
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].replace(/:.*$/, '').trim()
      if (headerKeys.includes(trimmed)) {
        if (startLine === null) startLine = i
        endLine = findBlockEnd(lines, i)
      }
    }
    return startLine !== null ? { from: startLine, to: endLine } : null
  }

  // Handle sections[i], sections[i].entries[j], sections[i].items[j], sections[i].title
  const sectionsMatch = path.match(/^sections\[(\d+)\](.*)$/)
  if (!sectionsMatch) return null

  const sectionIdx = parseInt(sectionsMatch[1], 10)
  const rest = sectionsMatch[2] // e.g. "", ".title", ".entries[0]", ".entries[0].dates"

  // Find the "sections:" key
  const sectionsKeyLine = lines.findIndex(l => l.match(/^sections\s*:/))
  if (sectionsKeyLine === -1) return null

  // Find the nth top-level array entry under sections (indent level ~2, starting with "- ")
  let currentSection = -1
  let sectionStart = -1
  let sectionEnd = -1

  for (let i = sectionsKeyLine + 1; i < lines.length; i++) {
    if (lines[i].match(/^\S/) && lines[i].trim() !== '') break // next top-level key
    if (lines[i].match(/^  - /)) {
      currentSection++
      if (currentSection === sectionIdx) {
        sectionStart = i
      } else if (currentSection > sectionIdx) {
        sectionEnd = i - 1
        // trim trailing blank lines
        while (sectionEnd > sectionStart && lines[sectionEnd].trim() === '') sectionEnd--
        break
      }
    }
  }

  if (sectionStart === -1) return null
  if (sectionEnd === -1) {
    // last section — find end of sections block
    sectionEnd = sectionStart
    for (let i = sectionStart + 1; i < lines.length; i++) {
      if (lines[i].match(/^\S/) && lines[i].trim() !== '') break
      if (lines[i].match(/^  - /)) break
      sectionEnd = i
    }
  }

  // If just sections[i], return the whole section
  if (!rest) return { from: sectionStart, to: sectionEnd }

  // sections[i].title — find the title line within the section
  if (rest === '.title') {
    for (let i = sectionStart; i <= sectionEnd; i++) {
      if (lines[i].match(/^\s+title\s*:/) || lines[i].match(/^  - title\s*:/)) {
        return { from: i, to: i }
      }
    }
    return { from: sectionStart, to: sectionStart }
  }

  // sections[i].entries[j] or sections[i].items[j]
  const subMatch = rest.match(/^\.(entries|items)\[(\d+)\]/)
  if (subMatch) {
    const subKey = subMatch[1]
    const subIdx = parseInt(subMatch[2], 10)

    // Find the entries/items key within this section
    let subKeyLine = -1
    for (let i = sectionStart; i <= sectionEnd; i++) {
      if (lines[i].match(new RegExp(`^\\s+${subKey}\\s*:`))) {
        subKeyLine = i
        break
      }
    }
    if (subKeyLine === -1) return { from: sectionStart, to: sectionEnd }

    // Find the nth array entry under this key (entries are "- " at subKeyIndent + 2)
    const subKeyIndent = lines[subKeyLine].search(/\S/)
    const entryIndent = subKeyIndent + 2
    let currentIdx = -1
    for (let i = subKeyLine + 1; i <= sectionEnd; i++) {
      const lineIndent = lines[i].search(/\S/)
      if (lineIndent === -1) continue // blank line
      if (lineIndent <= subKeyIndent) break // back to parent level
      if (lineIndent === entryIndent && lines[i].charAt(entryIndent) === '-') {
        currentIdx++
        if (currentIdx === subIdx) {
          const entryStart = i
          let entryEnd = i
          for (let j = i + 1; j <= sectionEnd; j++) {
            const jIndent = lines[j].search(/\S/)
            if (jIndent === -1) { entryEnd = j; continue } // blank line
            if (jIndent <= entryIndent && lines[j].charAt(jIndent) === '-') break // next entry
            if (jIndent <= subKeyIndent) break // back to parent
            entryEnd = j
          }
          return { from: entryStart, to: entryEnd }
        }
      }
    }
  }

  return { from: sectionStart, to: sectionEnd }
}

const HEADER_KEYS = ['name', 'contact', 'availability']

export function findYamlPathAtLine(yamlString, lineIdx) {
  const lines = yamlString.split('\n')
  if (lineIdx < 0 || lineIdx >= lines.length) return null

  const line = lines[lineIdx]
  const trimmedKey = line.replace(/:.*$/, '').trim()
  if (HEADER_KEYS.includes(trimmedKey)) return 'header'

  // Check if we're inside the sections block
  let sectionsKeyLine = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^sections\s*:/)) {
      sectionsKeyLine = i
      break
    }
  }

  if (sectionsKeyLine === -1 || lineIdx <= sectionsKeyLine) {
    // Check if inside header block
    for (let i = lineIdx; i >= 0; i--) {
      const key = lines[i].replace(/:.*$/, '').trim()
      if (lines[i].match(/^\S/) && HEADER_KEYS.includes(key)) return 'header'
      if (lines[i].match(/^\S/) && !HEADER_KEYS.includes(key)) return null
    }
    return null
  }

  // We're inside sections block — find which section and entry
  // Detect indent levels dynamically from the first section entry
  const sectionIndent = lines.slice(sectionsKeyLine + 1).find(l => l.match(/^\s+-\s/))
  const sectionDash = sectionIndent ? sectionIndent.search(/\S/) : 2

  let sectionIdx = -1
  let entryKey = null // 'entries' or 'items'
  let entryKeyIndent = -1
  let entryIdx = -1

  for (let i = sectionsKeyLine + 1; i <= lineIdx; i++) {
    const indent = lines[i].search(/\S/)
    if (indent === -1) continue // blank line
    if (indent === 0 && lines[i].trim() !== '') return null // past sections
    if (indent === sectionDash && lines[i].charAt(indent) === '-') {
      sectionIdx++
      entryKey = null
      entryKeyIndent = -1
      entryIdx = -1
    } else {
      const m = lines[i].match(/^\s+(entries|items)\s*:/)
      if (m) {
        entryKey = m[1]
        entryKeyIndent = lines[i].search(/\S/)
        entryIdx = -1
      } else if (entryKey && indent === entryKeyIndent + 2 && lines[i].charAt(indent) === '-') {
        entryIdx++
      }
    }
  }

  if (sectionIdx < 0) return null
  if (entryKey && entryIdx >= 0) return `sections[${sectionIdx}].${entryKey}[${entryIdx}]`
  return `sections[${sectionIdx}]`
}

function findBlockEnd(lines, startIdx) {
  const startIndent = lines[startIdx].search(/\S/)
  let end = startIdx
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      end = i
      continue
    }
    const indent = line.search(/\S/)
    if (indent <= startIndent) break
    end = i
  }
  return end
}

