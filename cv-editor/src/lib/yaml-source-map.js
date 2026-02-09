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
