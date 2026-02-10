import yaml from 'js-yaml'

export function applyInlineEdit(yamlString, path, newValue) {
  const data = yaml.load(yamlString)
  const resolvedPath = resolveHeaderPath(path)
  setNestedValue(data, parsePath(resolvedPath), newValue)
  return yaml.dump(data, {
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false,
    noRefs: true,
  })
}

function resolveHeaderPath(path) {
  if (path.startsWith('header.')) {
    return path.slice('header.'.length)
  }
  return path
}

function parsePath(path) {
  const parts = []
  const re = /([^.\[\]]+)|\[(\d+)\]/g
  let m
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) parts.push(m[1])
    else if (m[2] !== undefined) parts.push(parseInt(m[2], 10))
  }
  return parts
}

function setNestedValue(obj, parts, value) {
  for (let i = 0; i < parts.length - 1; i++) {
    obj = obj[parts[i]]
    if (obj === undefined || obj === null) return
  }
  obj[parts[parts.length - 1]] = value
}
