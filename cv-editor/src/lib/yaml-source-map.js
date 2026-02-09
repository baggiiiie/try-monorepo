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

  const match = path.match(/^(\w+)(?:\[(\d+)\])?$/)
  if (!match) return null
  const [, key, indexStr] = match

  const keyLineIdx = lines.findIndex(
    (line) => line.match(new RegExp(`^${key}\\s*:`))
  )
  if (keyLineIdx === -1) return null

  if (indexStr === undefined) {
    return { from: keyLineIdx, to: findBlockEnd(lines, keyLineIdx) }
  }

  const targetIndex = parseInt(indexStr, 10)
  let currentIndex = -1

  for (let i = keyLineIdx + 1; i < lines.length; i++) {
    if (lines[i].match(/^\S/) && lines[i].trim() !== '') break

    if (lines[i].match(/^\s{1,4}-\s/)) {
      currentIndex++
      if (currentIndex === targetIndex) {
        const entryStart = i
        const entryEnd = findEntryEnd(lines, i)
        return { from: entryStart, to: entryEnd }
      }
    }
  }

  return null
}

const SECTION_KEYS = ['education', 'experience', 'other_experience', 'skills', 'distinctions']
const HEADER_KEYS = ['name', 'contact', 'availability']

export function findYamlPathAtLine(yamlString, lineIdx) {
  const lines = yamlString.split('\n')
  if (lineIdx < 0 || lineIdx >= lines.length) return null

  const line = lines[lineIdx]
  const trimmedKey = line.replace(/:.*$/, '').trim()
  if (HEADER_KEYS.includes(trimmedKey)) return 'header'

  let sectionKey = null
  let entryIndex = -1
  let insideEntry = false

  for (let i = 0; i <= lineIdx; i++) {
    const l = lines[i]
    const key = l.replace(/:.*$/, '').trim()
    if (l.match(/^\S/) && l.trim() !== '') {
      if (SECTION_KEYS.includes(key)) {
        sectionKey = key
        entryIndex = -1
        insideEntry = false
      } else if (HEADER_KEYS.includes(key)) {
        sectionKey = 'header'
        insideEntry = false
      } else {
        sectionKey = null
        insideEntry = false
      }
    } else if (sectionKey && sectionKey !== 'header' && l.match(/^\s{1,4}-\s/)) {
      entryIndex++
      insideEntry = true
    }
  }

  if (!sectionKey) return null
  if (sectionKey === 'header') return 'header'
  if (insideEntry && entryIndex >= 0) return `${sectionKey}[${entryIndex}]`
  return sectionKey
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

function findEntryEnd(lines, startIdx) {
  let end = startIdx
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      end = i
      continue
    }
    if (line.match(/^\S/)) break
    if (line.match(/^\s{1,4}-\s/)) break
    end = i
  }
  return end
}
