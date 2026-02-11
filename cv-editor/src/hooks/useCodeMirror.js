import { useRef, useEffect } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'

const fullHeightTheme = EditorView.theme({
  '&': { height: '100%', flex: '1' },
  '.cm-scroller': { overflow: 'auto' },
})

function useCodeMirror({ containerRef, initialDoc, extensions, onDocChange }) {
  const viewRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || viewRef.current) return

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          ...extensions,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onDocChange(update.state.doc.toString())
            }
          }),
          fullHeightTheme,
        ],
      }),
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  return viewRef
}

export default useCodeMirror
