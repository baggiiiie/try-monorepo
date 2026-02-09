import { useState, useEffect, useRef, useCallback } from 'react'
import yaml from 'js-yaml'
import DOMPurify from 'dompurify'
import { renderCV } from '../lib/cv-renderer'
import { getPreviewFrameHTML } from '../lib/cv-preview-frame'
import { CV_STYLES } from '../lib/cv-styles'
import defaultYaml from '../../cv-data.yaml?raw'
import ImportPdfButton from '../components/ImportPdfButton'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import { css as cssLang } from '@codemirror/lang-css'

const LOCALSTORAGE_KEY = 'cv-editor-yaml'
const LOCALSTORAGE_CSS_KEY = 'cv-editor-css'
const DEBOUNCE_MS = 300

const sanitize = (html) =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'a', 'span'],
    ALLOWED_ATTR: ['class', 'href'],
  })

export default function CvEditor() {
  const [yamlString, setYamlString] = useState(
    () => localStorage.getItem(LOCALSTORAGE_KEY) || defaultYaml
  )
  const [cssString, setCssString] = useState(
    () => localStorage.getItem(LOCALSTORAGE_CSS_KEY) || CV_STYLES
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

  const sendToFrame = useCallback((html) => {
    if (frameReady.current && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: 'update-content', html },
        '*'
      )
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

  const sendCssToFrame = useCallback((css) => {
    if (frameReady.current && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: 'update-styles', css },
        '*'
      )
    }
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === 'frame-ready') {
        frameReady.current = true
        sendToFrame(lastValidHtml)
        sendCssToFrame(cssString)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [lastValidHtml, cssString, sendToFrame, sendCssToFrame])

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(LOCALSTORAGE_KEY, yamlString)
      try {
        const data = yaml.load(yamlString)
        setError(null)
        const html = renderCV(data, sanitize)
        setLastValidHtml(html)
        sendToFrame(html)
      } catch (e) {
        setError(e.message)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [yamlString, sendToFrame])

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(LOCALSTORAGE_CSS_KEY, cssString)
      sendCssToFrame(cssString)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [cssString, sendCssToFrame])

  useEffect(() => {
    if (!editorContainerRef.current || editorViewRef.current) return

    const view = new EditorView({
      state: EditorState.create({
        doc: yamlString,
        extensions: [
          basicSetup,
          yamlLang(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setYamlString(update.state.doc.toString())
            }
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
        <h1 className="text-lg font-semibold text-gray-700">CV Editor</h1>
        <div className="flex items-center gap-2">
          <ImportPdfButton onYamlGenerated={handleImportYaml} />
          <button
            onClick={handleExportPdf}
            className="px-4 py-1.5 bg-gray-800 text-white text-sm font-medium rounded-md hover:bg-gray-700 transition-colors cursor-pointer"
          >
            Export to PDF
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
          <div className="flex border-b border-gray-200 shrink-0">
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
          <div
            ref={editorContainerRef}
            className={`flex-1 overflow-hidden flex flex-col ${activeTab !== 'yaml' ? 'hidden' : ''}`}
          />
          <div
            ref={cssEditorContainerRef}
            className={`flex-1 overflow-hidden flex flex-col ${activeTab !== 'css' ? 'hidden' : ''}`}
          />
        </div>
      </div>
    </div>
  )
}
