import { useState } from 'react'
import yaml from 'js-yaml'

function HeaderForm({ data, onChange }) {
  const update = (field, value) => {
    onChange({ ...data, [field]: value })
  }
  const updateContact = (field, value) => {
    onChange({ ...data, contact: { ...data.contact, [field]: value } })
  }
  const updateLinkedin = (field, value) => {
    onChange({
      ...data,
      contact: {
        ...data.contact,
        linkedin: { ...data.contact?.linkedin, [field]: value },
      },
    })
  }

  return (
    <div className="space-y-3">
      <SectionHeading title="Personal Info" />
      <FormField label="Name" value={data.name || ''} onChange={(v) => update('name', v)} />
      <FormField label="Phone" value={data.contact?.phone || ''} onChange={(v) => updateContact('phone', v)} />
      <FormField label="Email" value={data.contact?.email || ''} onChange={(v) => updateContact('email', v)} />
      <FormField label="LinkedIn URL" value={data.contact?.linkedin?.url || ''} onChange={(v) => updateLinkedin('url', v)} />
      <FormField label="LinkedIn Label" value={data.contact?.linkedin?.label || ''} onChange={(v) => updateLinkedin('label', v)} />
      <FormField label="Availability" value={data.availability || ''} onChange={(v) => update('availability', v)} />
    </div>
  )
}

function FormField({ label, value, onChange, multiline }) {
  const Tag = multiline ? 'textarea' : 'input'
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      <Tag
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 block w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:ring-0 focus:outline-none"
        rows={multiline ? 3 : undefined}
      />
    </label>
  )
}

function SectionHeading({ title, onChange }) {
  if (!onChange) {
    return (
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-200 pb-1 mt-2">
        {title}
      </h3>
    )
  }
  return (
    <input
      value={title}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-200 pb-1 mt-2 bg-transparent focus:text-gray-600 focus:outline-none"
    />
  )
}

function DetailTypeSelect({ detail, onChange }) {
  const type = getDetailType(detail)
  const text = getDetailText(detail)

  const handleTypeChange = (newType) => {
    if (newType === 'text') onChange({ text })
    else if (newType === 'italic') onChange({ italic: text })
    else if (newType === 'coursework') onChange({ coursework: text })
    else onChange(text)
  }

  const handleTextChange = (newText) => {
    if (type === 'text') onChange({ text: newText })
    else if (type === 'italic') onChange({ italic: newText })
    else if (type === 'coursework') onChange({ coursework: newText })
    else onChange(newText)
  }

  return (
    <div className="flex gap-2 items-start">
      <select
        value={type}
        onChange={(e) => handleTypeChange(e.target.value)}
        className="shrink-0 mt-0.5 rounded border border-gray-300 px-1.5 py-1.5 text-xs text-gray-700 bg-white focus:border-gray-500 focus:outline-none"
      >
        <option value="text">Text</option>
        <option value="italic">Italic</option>
        <option value="coursework">Coursework</option>
      </select>
      <input
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        className="flex-1 rounded border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:ring-0 focus:outline-none"
      />
      <button
        onClick={() => onChange(null)}
        className="shrink-0 mt-0.5 text-gray-400 hover:text-red-500 text-lg leading-none cursor-pointer"
        title="Remove"
      >
        ×
      </button>
    </div>
  )
}

function getDetailType(d) {
  if (typeof d === 'string') return 'text'
  if (d?.italic !== undefined) return 'italic'
  if (d?.coursework !== undefined) return 'coursework'
  return 'text'
}

function getDetailText(d) {
  if (typeof d === 'string') return d
  return d?.italic || d?.text || d?.coursework || ''
}

function EntryCard({ entry, onChange, onRemove, showRole }) {
  const update = (field, value) => {
    onChange({ ...entry, [field]: value })
  }

  const updateDetail = (idx, value) => {
    const details = [...(entry.details || [])]
    if (value === null) {
      details.splice(idx, 1)
    } else {
      details[idx] = value
    }
    update('details', details.length > 0 ? details : undefined)
  }

  const addDetail = () => {
    update('details', [...(entry.details || []), { text: '' }])
  }

  const updateBullet = (idx, value) => {
    const bullets = [...(entry.bullets || [])]
    if (value === null) {
      bullets.splice(idx, 1)
    } else {
      bullets[idx] = value
    }
    update('bullets', bullets.length > 0 ? bullets : undefined)
  }

  const addBullet = () => {
    update('bullets', [...(entry.bullets || []), ''])
  }

  const moveBullet = (idx, dir) => {
    const bullets = [...(entry.bullets || [])]
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= bullets.length) return
    ;[bullets[idx], bullets[newIdx]] = [bullets[newIdx], bullets[idx]]
    update('bullets', bullets)
  }

  const moveDetail = (idx, dir) => {
    const details = [...(entry.details || [])]
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= details.length) return
    ;[details[idx], details[newIdx]] = [details[newIdx], details[idx]]
    update('details', details)
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700 truncate">
          {entry.institution || 'New Entry'}
        </span>
        <button
          onClick={onRemove}
          className="text-xs text-gray-400 hover:text-red-500 cursor-pointer"
        >
          Remove
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <FormField label="Dates" value={entry.dates || ''} onChange={(v) => update('dates', v)} />
        <FormField label="Institution" value={entry.institution || ''} onChange={(v) => update('institution', v)} />
        <FormField label="Location" value={entry.location || ''} onChange={(v) => update('location', v)} />
      </div>
      {showRole ? (
        <FormField label="Role" value={entry.role || ''} onChange={(v) => update('role', v)} />
      ) : (
        <FormField label="Degree" value={entry.degree || ''} onChange={(v) => update('degree', v)} />
      )}

      {(entry.details || []).length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Details</span>
          {entry.details.map((d, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="flex flex-col shrink-0">
                <button onClick={() => moveDetail(i, -1)} className="text-gray-400 hover:text-gray-600 text-xs leading-none cursor-pointer" disabled={i === 0}>↑</button>
                <button onClick={() => moveDetail(i, 1)} className="text-gray-400 hover:text-gray-600 text-xs leading-none cursor-pointer" disabled={i === entry.details.length - 1}>↓</button>
              </div>
              <div className="flex-1">
                <DetailTypeSelect detail={d} onChange={(v) => updateDetail(i, v)} />
              </div>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={addDetail}
        className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer"
      >
        + Add detail
      </button>

      {(entry.bullets || []).length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Bullets</span>
          {entry.bullets.map((b, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="flex flex-col shrink-0">
                <button onClick={() => moveBullet(i, -1)} className="text-gray-400 hover:text-gray-600 text-xs leading-none cursor-pointer" disabled={i === 0}>↑</button>
                <button onClick={() => moveBullet(i, 1)} className="text-gray-400 hover:text-gray-600 text-xs leading-none cursor-pointer" disabled={i === entry.bullets.length - 1}>↓</button>
              </div>
              <input
                value={b}
                onChange={(e) => updateBullet(i, e.target.value)}
                className="flex-1 rounded border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:ring-0 focus:outline-none"
              />
              <button
                onClick={() => updateBullet(i, null)}
                className="shrink-0 text-gray-400 hover:text-red-500 text-lg leading-none cursor-pointer"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={addBullet}
        className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer"
      >
        + Add bullet
      </button>
    </div>
  )
}

function SectionForm({ title, onTitleChange, entries, onChange }) {
  const showRole = entries.some(e => e.role !== undefined)

  const updateEntry = (idx, entry) => {
    const next = [...entries]
    next[idx] = entry
    onChange(next)
  }

  const removeEntry = (idx) => {
    onChange(entries.filter((_, i) => i !== idx))
  }

  const addEntry = () => {
    const template = showRole
      ? { dates: '', institution: '', location: '', role: '', bullets: [''] }
      : { dates: '', institution: '', location: '', degree: '', details: [{ text: '' }] }
    onChange([...entries, template])
  }

  const moveEntry = (idx, dir) => {
    const next = [...entries]
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= next.length) return
    ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <SectionHeading title={title} onChange={onTitleChange} />
      {entries.map((entry, i) => (
        <div key={i} className="flex gap-1">
          <div className="flex flex-col justify-center shrink-0 gap-0.5">
            <button onClick={() => moveEntry(i, -1)} className="text-gray-400 hover:text-gray-600 text-xs cursor-pointer" disabled={i === 0}>↑</button>
            <button onClick={() => moveEntry(i, 1)} className="text-gray-400 hover:text-gray-600 text-xs cursor-pointer" disabled={i === entries.length - 1}>↓</button>
          </div>
          <div className="flex-1">
            <EntryCard
              entry={entry}
              onChange={(e) => updateEntry(i, e)}
              onRemove={() => removeEntry(i)}
              showRole={showRole}
            />
          </div>
        </div>
      ))}
      <button
        onClick={addEntry}
        className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer"
      >
        + Add entry
      </button>
    </div>
  )
}

function SimpleListForm({ title, onTitleChange, items, onChange }) {
  const updateItem = (idx, value) => {
    const next = [...items]
    next[idx] = value
    onChange(next)
  }

  const removeItem = (idx) => {
    onChange(items.filter((_, i) => i !== idx))
  }

  const addItem = () => {
    onChange([...items, ''])
  }

  return (
    <div className="space-y-2">
      <SectionHeading title={title} onChange={onTitleChange} />
      <p className="text-xs text-gray-400">HTML tags like &lt;b&gt;, &lt;i&gt;, &lt;a&gt; are supported.</p>
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-start">
          <input
            value={item}
            onChange={(e) => updateItem(i, e.target.value)}
            className="flex-1 rounded border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:ring-0 focus:outline-none"
          />
          <button
            onClick={() => removeItem(i)}
            className="shrink-0 mt-0.5 text-gray-400 hover:text-red-500 text-lg leading-none cursor-pointer"
            title="Remove"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={addItem}
        className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer"
      >
        + Add item
      </button>
    </div>
  )
}

export default function FormEditor({ yamlString, onYamlChange }) {
  const [parseError, setParseError] = useState(null)

  let data
  try {
    data = yaml.load(yamlString) || {}
    if (parseError) setParseError(null)
  } catch (e) {
    return (
      <div className="p-4 space-y-3">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm font-medium text-amber-800">Cannot parse YAML</p>
          <p className="text-xs text-amber-600 mt-1">Fix errors in Code mode before switching to Visual mode.</p>
          <pre className="text-xs text-amber-700 mt-2 whitespace-pre-wrap font-mono">{e.message}</pre>
        </div>
      </div>
    )
  }

  const emit = (updatedData) => {
    try {
      const newYaml = yaml.dump(updatedData, {
        lineWidth: -1,
        quotingType: '"',
        forceQuotes: false,
        noRefs: true,
      })
      onYamlChange(newYaml)
    } catch (e) {
      console.error('Failed to serialize YAML:', e)
    }
  }

  const updateHeader = (headerData) => {
    emit({
      ...data,
      name: headerData.name,
      contact: headerData.contact,
      availability: headerData.availability,
    })
  }

  const sections = data.sections || []

  const updateSection = (idx, updated) => {
    const next = [...sections]
    next[idx] = { ...next[idx], ...updated }
    emit({ ...data, sections: next })
  }

  const moveSection = (idx, dir) => {
    const next = [...sections]
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= next.length) return
    ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
    emit({ ...data, sections: next })
  }

  const removeSection = (idx) => {
    const section = sections[idx]
    const hasContent = section.entries?.length > 0 || section.items?.some(item => item.trim() !== '')
    if (hasContent && !window.confirm(`Remove section "${section.title}"? This cannot be undone.`)) return
    emit({ ...data, sections: sections.filter((_, i) => i !== idx) })
  }

  const addSection = (type) => {
    const newSection = type === 'entries'
      ? { title: 'New Section', entries: [{ dates: '', institution: '', location: '', degree: '' }] }
      : { title: 'New Section', items: [''] }
    emit({ ...data, sections: [...sections, newSection] })
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <HeaderForm
        data={{ name: data.name, contact: data.contact || {}, availability: data.availability }}
        onChange={updateHeader}
      />

      {sections.map((section, i) => (
        <div key={section.title + '-' + (section.entries ? 'e' : 'i') + '-' + i} className="relative">
          <div className="flex items-center gap-1 mb-1">
            <div className="flex flex-col shrink-0">
              <button onClick={() => moveSection(i, -1)} className="text-gray-400 hover:text-gray-600 text-xs cursor-pointer" disabled={i === 0}>↑</button>
              <button onClick={() => moveSection(i, 1)} className="text-gray-400 hover:text-gray-600 text-xs cursor-pointer" disabled={i === sections.length - 1}>↓</button>
            </div>
            <div className="flex-1">
              {section.entries ? (
                <SectionForm
                  title={section.title}
                  onTitleChange={(title) => updateSection(i, { title })}
                  entries={section.entries}
                  onChange={(entries) => updateSection(i, { entries })}
                />
              ) : (
                <SimpleListForm
                  title={section.title}
                  onTitleChange={(title) => updateSection(i, { title })}
                  items={section.items || []}
                  onChange={(items) => updateSection(i, { items })}
                />
              )}
            </div>
            <button
              onClick={() => removeSection(i)}
              className="shrink-0 text-gray-400 hover:text-red-500 text-xs cursor-pointer self-start mt-2"
              title="Remove section"
            >
              ×
            </button>
          </div>
        </div>
      ))}

      <div className="flex gap-2 pt-2 border-t border-gray-200">
        <button onClick={() => addSection('entries')} className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer">+ Add entry section</button>
        <button onClick={() => addSection('items')} className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer">+ Add list section</button>
      </div>
    </div>
  )
}
