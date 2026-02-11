import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect } from 'react'

const menuButtonClass = (isActive) =>
    `px-2 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${isActive
        ? 'bg-gray-800 text-white'
        : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
    }`

function MenuBar({ editor }) {
    if (!editor) return null
    return (
        <div className="flex items-center gap-1 p-2 border-b border-gray-200 bg-gray-50 rounded-t-lg flex-wrap">
            <button onClick={() => editor.chain().focus().toggleBold().run()} className={menuButtonClass(editor.isActive('bold'))}>
                <strong>B</strong>
            </button>
            <button onClick={() => editor.chain().focus().toggleItalic().run()} className={menuButtonClass(editor.isActive('italic'))}>
                <em>I</em>
            </button>
            <button onClick={() => editor.chain().focus().toggleStrike().run()} className={menuButtonClass(editor.isActive('strike'))}>
                <s>S</s>
            </button>
            <div className="w-px h-5 bg-gray-300 mx-1" />
            <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={menuButtonClass(editor.isActive('bulletList'))}>
                • List
            </button>
            <button onClick={() => editor.chain().focus().toggleOrderedList().run()} className={menuButtonClass(editor.isActive('orderedList'))}>
                1. List
            </button>
            <div className="w-px h-5 bg-gray-300 mx-1" />
            <button onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} className={menuButtonClass(false)}>
                ↩
            </button>
            <button onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} className={menuButtonClass(false)}>
                ↪
            </button>
        </div>
    )
}

export default function TiptapEditorPopup({ isOpen, initialContent, isHtml, onSave, onClose }) {
    const editor = useEditor({
        extensions: [StarterKit],
        content: '',
        editorProps: {
            attributes: {
                class: 'prose prose-sm max-w-none focus:outline-none min-h-[120px] p-4',
            },
        },
    })

    useEffect(() => {
        if (editor && isOpen) {
            editor.commands.setContent(initialContent || '')
        }
    }, [editor, isOpen, initialContent])

    if (!isOpen) return null

    const handleSave = () => {
        if (!editor) return
        // Strip outer <p> wrapper if the content is a single paragraph,
        // so it integrates cleanly into container elements (li, span, div, etc.)
        let html = editor.getHTML()
        const match = html.match(/^<p>(.*)<\/p>$/s)
        if (match && !html.includes('</p><p>')) {
            html = match[1]
        }
        onSave(html)
    }

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) onClose()
    }

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') onClose()
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={handleBackdropClick}
            onKeyDown={handleKeyDown}
        >
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 flex flex-col overflow-hidden border border-gray-200">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-xl">
                    <h3 className="text-sm font-semibold text-gray-700">Edit Content</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none cursor-pointer"
                    >
                        ✕
                    </button>
                </div>

                <MenuBar editor={editor} />

                <div className="border-b border-gray-200 max-h-[400px] overflow-y-auto">
                    <EditorContent editor={editor} />
                </div>

                <div className="flex items-center justify-end gap-2 px-4 py-3 bg-gray-50 rounded-b-xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-1.5 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-700 transition-colors cursor-pointer"
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    )
}
