import { useState, useEffect, useRef, useCallback } from 'react'
import yaml from 'js-yaml'
import DOMPurify from 'dompurify'
import { renderCV } from '../lib/cv-renderer'
import { getPreviewFrameHTML } from '../lib/cv-preview-frame'
import { CV_STYLES } from '../lib/cv-styles'
import defaultYaml from '../../cv-data.yaml?raw'

const LOCALSTORAGE_KEY = 'cv-editor-yaml'
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
  const [error, setError] = useState(null)
  const [lastValidHtml, setLastValidHtml] = useState('')
  const iframeRef = useRef(null)
  const frameReady = useRef(false)

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

  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === 'frame-ready') {
        frameReady.current = true
        sendToFrame(lastValidHtml)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [lastValidHtml, sendToFrame])

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

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {error && (
        <div className="bg-red-100 border-b border-red-300 text-red-800 px-4 py-2 text-sm font-mono">
          YAML Error: {error}
        </div>
      )}
      <div className="flex items-center justify-between px-4 pt-4">
        <h1 className="text-lg font-semibold text-gray-700">CV Editor</h1>
        <button
          onClick={handleExportPdf}
          className="px-4 py-1.5 bg-gray-800 text-white text-sm font-medium rounded-md hover:bg-gray-700 transition-colors cursor-pointer"
        >
          Export to PDF
        </button>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-4 p-4 min-h-0">
        <div className="bg-white rounded-lg shadow overflow-hidden min-h-0">
          <iframe
            ref={iframeRef}
            srcDoc={getPreviewFrameHTML(CV_STYLES)}
            className="w-full h-full border-0"
            title="CV Preview"
            sandbox="allow-scripts allow-modals"
          />
        </div>
        <div className="bg-white rounded-lg shadow overflow-hidden min-h-0">
          <textarea
            value={yamlString}
            onChange={(e) => setYamlString(e.target.value)}
            className="w-full h-full p-4 font-mono text-sm resize-none outline-none bg-transparent"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  )
}
