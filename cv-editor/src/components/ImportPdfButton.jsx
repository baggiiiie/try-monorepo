import { useRef, useState } from 'react'
import { extractTextFromPdf } from '../lib/pdf-extractor'
import { convertResumeToYaml } from '../lib/resume-to-yaml'

export default function ImportPdfButton({ onYamlGenerated }) {
  const fileInputRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    e.target.value = ''
    setLoading(true)
    setError(null)

    try {
      const pdfText = await extractTextFromPdf(file)
      if (!pdfText.trim()) {
        throw new Error('Could not extract text from PDF. The file may be image-based.')
      }
      const yaml = await convertResumeToYaml(pdfText)
      onYamlGenerated(yaml)
    } catch (err) {
      setError(err.message)
      setTimeout(() => setError(null), 8000)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={handleFileChange}
      />
      <button
        onClick={handleClick}
        disabled={loading}
        className="px-4 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Converting...' : 'Import PDF'}
      </button>
      {error && (
        <span className="text-red-600 text-xs ml-2 max-w-xs truncate">{error}</span>
      )}
    </>
  )
}
