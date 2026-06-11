import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

const TriageItem = Type.Object({
  index: Type.Number({ description: '1-based index of the input email' }),
  reason: Type.String({ description: 'Short reason for this classification' }),
})

const submitEmailTriage = defineTool({
  name: 'submit_email_triage',
  label: 'Submit Email Triage',
  description: 'Submit the final structured triage for a list of unread emails.',
  promptSnippet: 'Use submit_email_triage as the final answer for unread email triage.',
  promptGuidelines: [
    'Classify every input email index exactly once.',
    'Use archive_now only for emails that are safe to archive after user approval.',
    'Use needs_attention for direct asks, important human messages, incidents, security/customer issues, blockers, or messages the user should read.',
    'Use unsure when the content is ambiguous or insufficient.',
    'After calling submit_email_triage, do not emit another assistant response in the same turn.',
  ],
  parameters: Type.Object({
    summary: Type.String({ description: 'Brief overall summary of the unread email batch' }),
    archive_now: Type.Array(TriageItem, { description: 'Routine/low-value emails that can be archived after user approval' }),
    needs_attention: Type.Array(TriageItem, { description: 'Emails the user should review or act on' }),
    unsure: Type.Array(TriageItem, { description: 'Emails that are ambiguous or borderline' }),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: 'text', text: 'Submitted structured email triage.' }],
      details: params,
      terminate: true,
    }
  },
})

export default function (pi: ExtensionAPI) {
  pi.registerTool(submitEmailTriage)
}
