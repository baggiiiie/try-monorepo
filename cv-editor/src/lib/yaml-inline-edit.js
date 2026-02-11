import yaml from 'js-yaml'
import { YAML_DUMP_OPTIONS, parsePath } from './yaml-mutations'

export function applyInlineEdit(yamlString, path, newValue) {
  const data = yaml.load(yamlString)
  const resolvedPath = path.startsWith('header.') ? path.slice('header.'.length) : path
  setNestedValue(data, parsePath(resolvedPath), newValue)
  return yaml.dump(data, YAML_DUMP_OPTIONS)
}

function setNestedValue(obj, parts, value) {
  for (let i = 0; i < parts.length - 1; i++) {
    obj = obj[parts[i]]
    if (obj === undefined || obj === null) return
  }
  obj[parts[parts.length - 1]] = value
}
