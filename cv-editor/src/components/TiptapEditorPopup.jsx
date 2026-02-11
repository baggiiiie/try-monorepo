import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import { useEffect, useState, useRef } from 'react'

const menuButtonClass = (isActive) =>
    `px-2 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${isActive
        ? 'bg-gray-800 text-white'
        : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
    }`

function LinkPopover({ editor, onClose }) {
    const [url, setUrl] = useState(editor.getAttributes('link').href || '')
    const inputRef = useRef(null)

    useEffect(() => {
        inputRef.current?.focus()
    }, [])

    const apply = () => {
        if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
        } else {
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
        }
        onClose()
    }

    return (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-white border border-gray-300 rounded-lg shadow-lg">
            <input
                ref={inputRef}
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') apply()
                    if (e.key === 'Escape') { onClose(); editor.commands.focus() }
                }}
                placeholder="https://..."
                className="w-48 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-gray-400"
            />
            <button onClick={apply} className="px-2 py-1 text-xs font-medium text-white bg-gray-800 rounded hover:bg-gray-700 cursor-pointer">
                Apply
            </button>
            {editor.isActive('link') && (
                <button
                    onClick={() => {
                        editor.chain().focus().extendMarkRange('link').unsetLink().run()
                        onClose()
                    }}
                    className="px-2 py-1 text-xs font-medium text-red-600 bg-white border border-red-200 rounded hover:bg-red-50 cursor-pointer"
                >
                    Remove
                </button>
            )}
        </div>
    )
}

function MenuBar({ editor }) {
    const [showLinkPopover, setShowLinkPopover] = useState(false)
    const [, forceUpdate] = useState(0)

    useEffect(() => {
        if (!editor) return
        const handler = () => forceUpdate(n => n + 1)
        editor.on('transaction', handler)
        return () => editor.off('transaction', handler)
    }, [editor])

    if (!editor) return null

    return (
        <div className="flex items-center gap-1 p-2 border-b border-gray-200 bg-gray-50 rounded-t-lg flex-wrap relative">
            <button onClick={() => editor.chain().focus().toggleBold().run()} className={menuButtonClass(editor.isActive('bold'))}>
                <strong>B</strong>
            </button>
            <button onClick={() => editor.chain().focus().toggleItalic().run()} className={menuButtonClass(editor.isActive('italic'))}>
                <em>I</em>
            </button>
            <button onClick={() => editor.chain().focus().toggleUnderline().run()} className={menuButtonClass(editor.isActive('underline'))}>
                <u>U</u>
            </button>
            <button onClick={() => editor.chain().focus().toggleStrike().run()} className={menuButtonClass(editor.isActive('strike'))}>
                <s>S</s>
            </button>
            <div className="w-px h-5 bg-gray-300 mx-1" />
            <div className="relative">
                <button onClick={() => setShowLinkPopover(!showLinkPopover)} className={menuButtonClass(editor.isActive('link'))}>
                    Link
                </button>
                {showLinkPopover && (
                    <div className="absolute top-full left-0 mt-1 z-10">
                        <LinkPopover editor={editor} onClose={() => setShowLinkPopover(false)} />
                    </div>
                )}
            </div>
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

export default function TiptapEditorPopup({ isOpen, initialContent, onSave, onClose }) {
    const editor = useEditor({
        extensions: [
            StarterKit,
            Underline,
            Link.configure({
                openOnClick: false,
                HTMLAttributes: { class: 'text-blue-600 underline' },
            }),
        ],
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
