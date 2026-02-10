import { useState, useEffect, useRef, useCallback } from 'react'
import yaml from 'js-yaml'
import DOMPurify from 'dompurify'
import { renderCV } from '../lib/cv-renderer'
import { getPreviewFrameHTML } from '../lib/cv-preview-frame'
import { CV_STYLES, CV_TEMPLATES } from '../lib/cv-styles'
import defaultYaml from '../../cv-data.yaml?raw'
import ImportPdfButton from '../components/ImportPdfButton'
import FormEditor from '../components/FormEditor'
import { EditorView, Decoration } from '@codemirror/view'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import { css as cssLang } from '@codemirror/lang-css'
import { findYamlLineRange, findYamlPathAtLine } from '../lib/yaml-source-map'
import { applyInlineEdit } from '../lib/yaml-inline-edit'

const setHoverHighlight = StateEffect.define()

const hoverHighlightField = StateField.define({
  create() {
    return Decoration.none
  },
  update(decorations, tr) {
    for (const e of tr.effects) {
      if (e.is(setHoverHighlight)) {
        if (!e.value) return Decoration.none
        const { from, to } = e.value
        const builder = []
        for (let line = from; line <= to; line++) {
          const lineObj = tr.state.doc.line(line + 1)
          builder.push(
            hoverLineDeco.range(lineObj.from)
          )
        }
        return Decoration.set(builder)
      }
    }
    return decorations
  },
  provide: (f) => EditorView.decorations.from(f),
})

const hoverLineDeco = Decoration.line({ class: 'cm-hover-highlight' })

const hoverHighlightTheme = EditorView.theme({
  '.cm-hover-highlight': { background: 'rgba(255, 213, 79, 0.3)' },
})

const LOCALSTORAGE_KEY = 'cv-editor-yaml'
const LOCALSTORAGE_CSS_KEY = 'cv-editor-css'
const LOCALSTORAGE_TEMPLATE_KEY = 'cv-editor-template'
const LOCALSTORAGE_MODE_KEY = 'cv-editor-mode'
const DEBOUNCE_MS = 300

const sanitize = (html) =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'a', 'span'],
    ALLOWED_ATTR: ['class', 'href'],
  })

export default function CvEditor() {
  const storedTemplateId = localStorage.getItem(LOCALSTORAGE_TEMPLATE_KEY)
  const initialTemplate =
    CV_TEMPLATES.find((template) => template.id === storedTemplateId) ||
    CV_TEMPLATES[0]
  const [yamlString, setYamlString] = useState(
    () => localStorage.getItem(LOCALSTORAGE_KEY) || defaultYaml
  )
  const [cssString, setCssString] = useState(
    () => localStorage.getItem(LOCALSTORAGE_CSS_KEY) || initialTemplate.css || CV_STYLES
  )
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplate.id)
  const [editorMode, setEditorMode] = useState(
    () => localStorage.getItem(LOCALSTORAGE_MODE_KEY) || 'visual'
  )
  const [activeTab, setActiveTab] = useState('yaml')
  const [error, setError] = useState(null)
  const [lastValidHtml, setLastValidHtml] = useState('')
  const iframeRef = useRef(null)
  const frameReady = useRef(false)
  const editorContainerRef = useRef(null)
  const editorViewRef = useRef(null)
  const cssEditorContainerRef = useRef(null)
  const cssEditorViewRef = useRef(null)

  const postToFrame = useCallback((message) => {
    if (frameReady.current && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(message, '*')
    }
  }, [])

  const handleExportPdf = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'print' }, '*')
    }
  }

  const handleImportYaml = useCallback((newYaml) => {
    setYamlString(newYaml)
    if (editorViewRef.current) {
      editorViewRef.current.dispatch({
        changes: {
          from: 0,
          to: editorViewRef.current.state.doc.length,
          insert: newYaml,
        },
      })
    }
  }, [])

  const handleFormYamlChange = useCallback((newYaml) => {
    setYamlString(newYaml)
    if (editorViewRef.current) {
      editorViewRef.current.dispatch({
        changes: {
          from: 0,
          to: editorViewRef.current.state.doc.length,
          insert: newYaml,
        },
      })
    }
  }, [])

  const handleTemplateChange = useCallback((templateId) => {
    const template = CV_TEMPLATES.find((item) => item.id === templateId)
    if (!template) return
    setSelectedTemplateId(templateId)
    setCssString(template.css)
    if (cssEditorViewRef.current) {
      cssEditorViewRef.current.dispatch({
        changes: {
          from: 0,
          to: cssEditorViewRef.current.state.doc.length,
          insert: template.css,
        },
      })
    }
  }, [])

  const lastEditorHoverPath = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === 'frame-ready') {
        frameReady.current = true
        postToFrame({ type: 'update-content', html: lastValidHtml })
        postToFrame({ type: 'update-styles', css: cssString })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [lastValidHtml, cssString, postToFrame])

  useEffect(() => {
    const handler = (e) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      if (e.data?.type !== 'hover-path') return
      const view = editorViewRef.current
      if (!view) return
      const range = findYamlLineRange(view.state.doc.toString(), e.data.path)
      view.dispatch({ effects: setHoverHighlight.of(range) })
      if (range && activeTab === 'yaml') {
        const line = view.state.doc.line(range.from + 1)
        view.dispatch({
          effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
        })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [activeTab])

  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === 'inline-edit') {
        const { path, value } = e.data
        setYamlString((prev) => {
          try {
            const updated = applyInlineEdit(prev, path, value)
            if (editorViewRef.current) {
              editorViewRef.current.dispatch({
                changes: {
                  from: 0,
                  to: editorViewRef.current.state.doc.length,
                  insert: updated,
                },
              })
            }
            return updated
          } catch (err) {
            console.error('Inline edit failed:', err)
            return prev
          }
        })
      }
      if (e.data?.type === 'reorder-section') {
        const { fromIndex, toIndex } = e.data
        setYamlString((prev) => {
          try {
            const data = yaml.load(prev)
            const sections = [...(data.sections || [])]
            const [moved] = sections.splice(fromIndex, 1)
            const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex
            sections.splice(insertAt, 0, moved)
            data.sections = sections
            const updated = yaml.dump(data, {
              lineWidth: -1,
              quotingType: '"',
              forceQuotes: false,
              noRefs: true,
            })
            if (editorViewRef.current) {
              editorViewRef.current.dispatch({
                changes: {
                  from: 0,
                  to: editorViewRef.current.state.doc.length,
                  insert: updated,
                },
              })
            }
            return updated
          } catch (err) {
            console.error('Reorder failed:', err)
            return prev
          }
        })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(LOCALSTORAGE_KEY, yamlString)
      try {
        const data = yaml.load(yamlString)
        setError(null)
        const html = renderCV(data, sanitize)
        setLastValidHtml(html)
        postToFrame({ type: 'update-content', html })
      } catch (e) {
        setError(e.message)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [yamlString, postToFrame])

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(LOCALSTORAGE_CSS_KEY, cssString)
      postToFrame({ type: 'update-styles', css: cssString })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [cssString, postToFrame])

  useEffect(() => {
    localStorage.setItem(LOCALSTORAGE_TEMPLATE_KEY, selectedTemplateId)
  }, [selectedTemplateId])

  useEffect(() => {
    localStorage.setItem(LOCALSTORAGE_MODE_KEY, editorMode)
  }, [editorMode])

  useEffect(() => {
    if (!editorContainerRef.current || editorViewRef.current) return

    const view = new EditorView({
      state: EditorState.create({
        doc: yamlString,
        extensions: [
          basicSetup,
          yamlLang(),
          hoverHighlightField,
          hoverHighlightTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setYamlString(update.state.doc.toString())
            }
          }),
          EditorView.domEventHandlers({
            mousemove(e, view) {
              const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
              if (pos === null) return
              const lineIdx = view.state.doc.lineAt(pos).number - 1
              const yamlText = view.state.doc.toString()
              const path = findYamlPathAtLine(yamlText, lineIdx)
              if (path !== lastEditorHoverPath.current) {
                lastEditorHoverPath.current = path
                const range = path ? findYamlLineRange(yamlText, path) : null
                view.dispatch({ effects: setHoverHighlight.of(range) })
                postToFrame({ type: 'highlight-path', path })
              }
            },
            mouseleave(e, view) {
              if (lastEditorHoverPath.current !== null) {
                lastEditorHoverPath.current = null
                view.dispatch({ effects: setHoverHighlight.of(null) })
                postToFrame({ type: 'highlight-path', path: null })
              }
            },
          }),
          EditorView.theme({
            '&': { height: '100%', flex: '1' },
            '.cm-scroller': { overflow: 'auto' },
          }),
        ],
      }),
      parent: editorContainerRef.current,
    })

    editorViewRef.current = view
    return () => {
      view.destroy()
      editorViewRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!cssEditorContainerRef.current || cssEditorViewRef.current) return

    const view = new EditorView({
      state: EditorState.create({
        doc: cssString,
        extensions: [
          basicSetup,
          cssLang(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setCssString(update.state.doc.toString())
            }
          }),
          EditorView.theme({
            '&': { height: '100%', flex: '1' },
            '.cm-scroller': { overflow: 'auto' },
          }),
        ],
      }),
      parent: cssEditorContainerRef.current,
    })

    cssEditorViewRef.current = view
    return () => {
      view.destroy()
      cssEditorViewRef.current = null
    }
  }, [])

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {error && (
        <div className="bg-red-100 border-b border-red-300 text-red-800 px-4 py-2 text-sm font-mono">
          YAML Error: {error}
        </div>
      )}
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-700">CV Editor</h1>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
            Template
            <select
              value={selectedTemplateId}
              onChange={(e) => handleTemplateChange(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 shadow-sm focus:border-gray-500 focus:outline-none"
            >
              {CV_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <ImportPdfButton onYamlGenerated={handleImportYaml} />
          <button
            onClick={handleExportPdf}
            className="px-4 py-1.5 bg-gray-800 text-white text-sm font-medium rounded-md hover:bg-gray-700 transition-colors cursor-pointer"
          >
            Export to PDF
          </button>
          <button
            disabled
            onClick={() => {
              // TODO: Implement feedback functionality in the future
            }}
            className="px-4 py-1.5 bg-gray-200 text-gray-500 text-sm font-medium rounded-md cursor-not-allowed"
          >
            Feedback
          </button>
        </div>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-4 p-4 min-h-0">
        <div className="bg-gray-300 rounded-lg shadow overflow-hidden min-h-0">
          <iframe
            ref={iframeRef}
            srcDoc={getPreviewFrameHTML(cssString)}
            className="w-full h-full border-0"
            title="CV Preview"
            sandbox="allow-scripts allow-modals"
          />
        </div>
        <div className="bg-white rounded-lg shadow overflow-hidden min-h-0 flex flex-col">
          <div className="flex items-center border-b border-gray-200 shrink-0">
            <div className="flex items-center border-r border-gray-200">
              {['visual', 'code'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => setEditorMode(mode)}
                  className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide cursor-pointer transition-colors ${
                    editorMode === mode
                      ? 'text-white bg-gray-800'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {mode === 'visual' ? '✏ Visual' : '⟨/⟩ Code'}
                </button>
              ))}
            </div>
            {editorMode === 'code' && (
              <div className="flex">
                {['yaml', 'css'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 text-sm font-medium cursor-pointer transition-colors ${
                      activeTab === tab
                        ? 'text-gray-900 border-b-2 border-gray-800'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
          {editorMode === 'visual' && (
            <FormEditor yamlString={yamlString} onYamlChange={handleFormYamlChange} />
          )}
          <div
            ref={editorContainerRef}
            className={`flex-1 overflow-hidden flex flex-col ${editorMode !== 'code' || activeTab !== 'yaml' ? 'hidden' : ''}`}
          />
          <div
            ref={cssEditorContainerRef}
            className={`flex-1 overflow-hidden flex flex-col ${editorMode !== 'code' || activeTab !== 'css' ? 'hidden' : ''}`}
          />
        </div>
      </div>
    </div>
  )
}
